package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/gen2brain/beeep"

	"github.com/lugvitc/whats4linux/internal/cache"
	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/settings"
	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/lugvitc/whats4linux/internal/wa"
	"github.com/lugvitc/whats4linux/shared/socket"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/appstate"
	"github.com/polymorfa/hypermeow/proto/waE2E"
	"github.com/polymorfa/hypermeow/store/sqlstore"
	"github.com/polymorfa/hypermeow/types"
	"github.com/polymorfa/hypermeow/types/events"
	waLog "github.com/polymorfa/hypermeow/util/log"
)

// Api struct
type Api struct {
	ctx                 context.Context
	cw                  *wa.AppDatabase
	waClient            *whatsmeow.Client
	messageStore        *store.MessageStore
	imageCache          *cache.ImageCache
	us                  *socket.UnixSocket
	waContainer         *sqlstore.Container
	eventHandlerID      uint32
	eventHandlerSet     bool
	startupErr          error
	loginCancel         context.CancelFunc
	lifecycleMu         sync.Mutex
	loginMu             sync.Mutex
	eventMu             sync.RWMutex
	taskMu              sync.Mutex
	backgroundTasks     sync.WaitGroup
	shuttingDown        bool
	windowFocused       atomic.Bool
	groupRepairInFlight atomic.Bool
	appStateResync      atomic.Bool
	callManager         *wa.CallManager
	activeChatMu        sync.RWMutex
	activeChatId        string
}

// repairGroupNames heals whats4linux_groups rows that are missing or were
// stored with an empty name during early history sync. It runs in the
// background after the client connects (never on the GetChatList hot path,
// which must stay local-only and instant) and tells the frontend to reload
// the chat list once anything was fixed.
func (a *Api) repairGroupNames() {
	if !a.groupRepairInFlight.CompareAndSwap(false, true) {
		return
	}
	defer a.groupRepairInFlight.Store(false)

	repaired := 0
	for _, cm := range a.messageStore.GetChatList() {
		if cm.JID.Server != types.GroupServer {
			continue
		}
		if g, err := a.cw.FetchGroup(cm.JID.String()); err == nil && g.Name != "" {
			continue
		}
		gi, err := a.waClient.GetGroupInfo(a.ctx, cm.JID)
		if err != nil || gi == nil || gi.GroupName.Name == "" {
			continue
		}
		parentJID := ""
		if !gi.LinkedParentJID.IsEmpty() {
			parentJID = gi.LinkedParentJID.String()
		}
		if err := a.cw.StoreGroup(wa.Group{
			JID:              cm.JID.String(),
			Name:             gi.GroupName.Name,
			Topic:            gi.GroupTopic.Topic,
			OwnerJID:         gi.OwnerJID.String(),
			ParticipantCount: len(gi.Participants),
			ParentJID:        parentJID,
			ParentName:       a.cw.ParentCommunityName(parentJID),
			IsParent:         gi.IsParent,
			IsDefaultSub:     gi.IsDefaultSubGroup,
		}); err != nil {
			log.Println("repairGroupNames: failed to persist group:", cm.JID.String(), err)
			continue
		}
		repaired++
	}

	if repaired > 0 {
		log.Printf("repairGroupNames: repaired %d group name(s)", repaired)
		runtime.EventsEmit(a.ctx, "wa:chat_list_refresh")
	}
}

// resyncAppState fully syncs the regular_low app state collection (archive,
// pin and mute mutations). When the local hash chain is corrupted
// ("mismatching LTHash"), incremental sync fails forever and mutations from
// the phone never arrive — recover by dropping the local version and pulling
// the collection from scratch. Runs in the background after Connected.
func (a *Api) resyncAppState() {
	if !a.appStateResync.CompareAndSwap(false, true) {
		return
	}
	defer a.appStateResync.Store(false)

	// regular_low carries archive/pin mutations, regular_high carries mutes.
	// FetchAppState with fullSync=true resets the local version itself and
	// re-applies the collection from a server snapshot; with
	// EmitAppStateEventsOnFullSync set, every mutation is dispatched to
	// mainEventHandler (FromFullSync=true) and lands in our tables.
	for _, name := range []appstate.WAPatchName{appstate.WAPatchRegularLow, appstate.WAPatchRegularHigh} {
		if err := a.waClient.FetchAppState(a.ctx, name, true, false); err != nil {
			log.Printf("App state full sync failed for %s: %v", name, err)
			continue
		}
		log.Println("App state fully synced:", name)
	}
	runtime.EventsEmit(a.ctx, "wa:chat_list_refresh")
}

// htmlTagRE strips HTML tags from message previews so desktop notifications
// show plain text rather than markup.
var htmlTagRE = regexp.MustCompile(`<[^>]*>`)

// SetWindowFocused is called by the frontend on window focus/blur so the
// backend only raises notifications while the window is in the background.
func (a *Api) SetWindowFocused(focused bool) {
	a.windowFocused.Store(focused)
}

// SetActiveChat records which chat is currently open in the UI so incoming
// messages for that chat are suppressed while the user is actively viewing it.
func (a *Api) SetActiveChat(chatId string) {
	a.activeChatMu.Lock()
	a.activeChatId = chatId
	a.activeChatMu.Unlock()
}

func (a *Api) isSameChat(activeChat string, incomingChat types.JID) bool {
	if activeChat == "" {
		return false
	}
	if activeChat == incomingChat.String() {
		return true
	}
	activeJID, err := types.ParseJID(activeChat)
	if err == nil && a.waClient != nil {
		activeCanon := canonicalUserJID(a.ctx, a.waClient, activeJID)
		incomingCanon := canonicalUserJID(a.ctx, a.waClient, incomingChat)
		if activeCanon.String() == incomingCanon.String() {
			return true
		}
	}
	return false
}

// resolveGroupName returns the display name of a group chat, querying local cache,
// contacts store, or fetching from WhatsApp server as needed.
func (a *Api) resolveGroupName(chat types.JID) string {
	if a.cw != nil {
		if groupInfo, err := a.cw.FetchGroup(chat.String()); err == nil && groupInfo.Name != "" {
			return groupInfo.Name
		}
	}
	if a.waClient != nil {
		if a.waClient.Store != nil && a.waClient.Store.Contacts != nil {
			if contact, err := a.waClient.Store.Contacts.GetContact(a.ctx, chat); err == nil && contact.FullName != "" {
				return contact.FullName
			}
		}
		if a.waClient.IsConnected() {
			if gi, err := a.waClient.GetGroupInfo(a.ctx, chat); err == nil && gi != nil && gi.GroupName.Name != "" {
				if a.cw != nil {
					_ = a.cw.StoreGroup(wa.Group{
						JID:              chat.String(),
						Name:             gi.GroupName.Name,
						Topic:            gi.GroupTopic.Topic,
						OwnerJID:         gi.OwnerJID.String(),
						ParticipantCount: len(gi.Participants),
						IsParent:         gi.IsParent,
						IsDefaultSub:     gi.IsDefaultSubGroup,
					})
				}
				return gi.GroupName.Name
			}
		}
	}
	return ""
}

// resolveSenderName returns the contact name, push name, or formatted user ID for a sender.
func (a *Api) resolveSenderName(sender types.JID, pushName string) string {
	if pushName != "" {
		return pushName
	}
	if a.waClient != nil && a.waClient.Store != nil && a.waClient.Store.Contacts != nil {
		if contact, err := a.waClient.Store.Contacts.GetContact(a.ctx, sender); err == nil && contact.FullName != "" {
			return contact.FullName
		}
	}
	if sender.User != "" {
		return "+" + sender.User
	}
	return "Someone"
}

// notifyIncoming raises a desktop notification for an incoming message when the
// window isn't focused.
func (a *Api) notifyIncoming(v *events.Message, parsedHTML string, isEdit bool) {
	if a.messageStore != nil && (a.messageStore.IsChatArchived(v.Info.Chat.String()) || a.messageStore.IsChatMuted(v.Info.Chat.String())) {
		return
	}

	bodyText := strings.TrimSpace(htmlTagRE.ReplaceAllString(parsedHTML, ""))
	if bodyText == "" {
		if isEdit {
			bodyText = "Edited a message"
		} else {
			bodyText = "Sent you a message"
		}
	} else if isEdit {
		bodyText = "(Edited) " + bodyText
	}

	isGroup := v.Info.IsGroup || v.Info.Chat.Server == types.GroupServer
	var title, body string

	if isGroup {
		groupName := a.resolveGroupName(v.Info.Chat)
		senderName := a.resolveSenderName(v.Info.Sender, v.Info.PushName)
		if groupName != "" {
			title = groupName
			body = fmt.Sprintf("%s: %s", senderName, bodyText)
		} else {
			title = fmt.Sprintf("Group: %s", senderName)
			body = bodyText
		}
	} else {
		senderName := a.resolveSenderName(v.Info.Sender, v.Info.PushName)
		title = senderName
		body = bodyText
	}

	avatarPath := a.getNotificationAvatar(v.Info.Chat, v.Info.Sender)
	if err := beeep.Notify(title, body, avatarPath); err != nil {
		log.Println("notify failed:", err)
	}
}

// resolveAvatarPath returns the on-disk file path for a cached avatar, or "" if not found.
func (a *Api) resolveAvatarPath(jid types.JID) string {
	if a.imageCache == nil || jid.IsEmpty() {
		return ""
	}
	// 1. Direct JID
	if path := a.imageCache.GetAvatarAbsolutePath(jid.String()); path != "" {
		return path
	}
	// 2. Canonical user JID
	if a.waClient != nil {
		canon := canonicalUserJID(a.ctx, a.waClient, jid)
		if canon.String() != jid.String() {
			if path := a.imageCache.GetAvatarAbsolutePath(canon.String()); path != "" {
				return path
			}
		}
		// 3. LID lookup
		if jid.ActualAgent() == types.LIDDomain && a.waClient.Store != nil && a.waClient.Store.LIDs != nil {
			if pn, err := a.waClient.Store.LIDs.GetPNForLID(a.ctx, jid); err == nil && !pn.IsEmpty() {
				if path := a.imageCache.GetAvatarAbsolutePath(pn.String()); path != "" {
					return path
				}
			}
		}
	}
	return ""
}

// getNotificationAvatar resolves the best avatar file path for a message notification.
// Prefers group avatar for groups (falling back to sender avatar), and direct chat avatar for DMs.
func (a *Api) getNotificationAvatar(chat types.JID, sender types.JID) string {
	if a.imageCache == nil {
		return ""
	}
	if chat.Server == types.GroupServer {
		if path := a.resolveAvatarPath(chat); path != "" {
			return path
		}
		if path := a.resolveAvatarPath(sender); path != "" {
			return path
		}
		a.startBackground(func() {
			_, _ = a.GetCachedAvatar(chat.String(), false)
		})
		return ""
	}

	target := chat
	if target.IsEmpty() {
		target = sender
	}
	if path := a.resolveAvatarPath(target); path != "" {
		return path
	}

	if !target.IsEmpty() {
		a.startBackground(func() {
			_, _ = a.GetCachedAvatar(target.String(), false)
		})
	}
	return ""
}

// NewApi creates a new Api application struct
func New() *Api {
	return &Api{}
}

func (a *Api) startBackground(task func()) bool {
	a.taskMu.Lock()
	defer a.taskMu.Unlock()
	if a.shuttingDown {
		return false
	}
	a.backgroundTasks.Add(1)
	go func() {
		defer a.backgroundTasks.Done()
		task()
	}()
	return true
}

func (a *Api) isShuttingDown() bool {
	a.taskMu.Lock()
	defer a.taskMu.Unlock()
	return a.shuttingDown
}

func (a *Api) OnSecondInstanceLaunch(secondInstanceData options.SecondInstanceData) {
	runtime.WindowUnminimise(a.ctx)
	runtime.Show(a.ctx)
}

func (a *Api) Shutdown(ctx context.Context) {
	a.taskMu.Lock()
	a.shuttingDown = true
	a.taskMu.Unlock()

	a.lifecycleMu.Lock()
	client := a.waClient
	loginCancel := a.loginCancel
	if client != nil && a.eventHandlerSet {
		client.RemoveEventHandler(a.eventHandlerID)
		a.eventHandlerSet = false
	}
	a.lifecycleMu.Unlock()

	if loginCancel != nil {
		loginCancel()
	}
	if client != nil {
		client.Disconnect()
	}
	// Login may be waiting on the QR channel or finishing Connect. Cancellation
	// releases the QR wait; the second disconnect catches a Connect that raced
	// with shutdown after the first disconnect.
	a.loginMu.Lock()
	a.loginMu.Unlock()
	if client != nil {
		client.Disconnect()
	}
	// Wait for an event that entered before RemoveEventHandler and every
	// background task it launched before closing their stores.
	a.eventMu.Lock()
	a.eventMu.Unlock()
	a.backgroundTasks.Wait()

	if err := a.closeResources(); err != nil {
		log.Println("shutdown cleanup failed:", err)
	}
}

func (a *Api) closeResources() error {
	var closeErr error
	if a.us != nil {
		_ = a.us.SendCommand("shutdown")
		closeErr = errors.Join(closeErr, a.us.Close())
		a.us = nil
	}
	if a.messageStore != nil {
		closeErr = errors.Join(closeErr, a.messageStore.Close())
		a.messageStore = nil
	}
	if a.imageCache != nil {
		closeErr = errors.Join(closeErr, a.imageCache.Close())
		a.imageCache = nil
	}
	if a.cw != nil {
		closeErr = errors.Join(closeErr, a.cw.Close())
		a.cw = nil
	}
	if a.waContainer != nil {
		closeErr = errors.Join(closeErr, a.waContainer.Close())
		a.waContainer = nil
	}
	return closeErr
}

func (a *Api) failStartup(err error) {
	a.lifecycleMu.Lock()
	a.startupErr = err
	a.lifecycleMu.Unlock()
	log.Println("startup failed:", err)
	if closeErr := a.closeResources(); closeErr != nil {
		log.Println("startup cleanup failed:", closeErr)
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *Api) Startup(ctx context.Context) {
	// The window is focused when the app launches; the frontend keeps this in
	// sync via SetWindowFocused so we don't notify while the user is looking.
	a.windowFocused.Store(true)
	// Set the context before anything that may call back into the Api (the
	// systray command handler needs it for EventsEmit).
	a.ctx = ctx
	var err error
	a.us, err = socket.NewUnixSocket(ctx)
	if err != nil {
		a.failStartup(fmt.Errorf("create tray socket: %w", err))
		return
	}
	a.us.SetCommandHandler(a.trayCommandHandler)
	a.us.SetOnHide(func() {
		a.SetWindowFocused(false)
	})
	socketServer := a.us
	go func() {
		err := socketServer.ListenAndServe()
		if err != nil {
			log.Println("Unix socket server error:", err)
		}
	}()

	err = misc.StartSystray()
	if err != nil {
		log.Printf("failed to start systray: %v", err)
	}

	dbLog := waLog.Stdout("Database", settings.GetLogLevel(), true)
	a.cw, err = wa.NewAppDatabase(ctx)
	if err != nil {
		a.failStartup(fmt.Errorf("open application database: %w", err))
		return
	}
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("session.wa"))
	if err != nil {
		a.failStartup(fmt.Errorf("open WhatsApp session database: %w", err))
		return
	}
	container := sqlstore.NewWithDB(db, "sqlite3", dbLog)
	a.waContainer = container
	err = container.Upgrade(ctx)
	if err != nil {
		a.failStartup(fmt.Errorf("upgrade WhatsApp session database: %w", err))
		return
	}
	a.waClient = wa.NewClient(ctx, container)
	a.callManager = wa.NewCallManager(a.waClient, func(event string, data any) {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, event, data)
		}
		if event == "wa:call_incoming" {
			if a.ctx != nil {
				runtime.WindowUnminimise(a.ctx)
				runtime.Show(a.ctx)
			}
			callerName := "WhatsApp Contact"
			avatarPath := ""
			if m, ok := data.(map[string]any); ok {
				if name, ok := m["peerName"].(string); ok && name != "" {
					callerName = name
				}
				if jidStr, ok := m["peerJid"].(string); ok && jidStr != "" {
					if parsed, err := types.ParseJID(jidStr); err == nil {
						avatarPath = a.resolveAvatarPath(parsed)
					}
				}
			}
			_ = beeep.Notify("Incoming WhatsApp Call", fmt.Sprintf("Call from %s", callerName), avatarPath)
		}
	}, store.GetIncomingCallSoundsEnabled, store.GetOutgoingSoundsEnabled)
	a.messageStore, err = store.NewMessageStore()
	if err != nil {
		a.failStartup(fmt.Errorf("open message store: %w", err))
		return
	}
	a.imageCache, err = cache.NewImageCache()
	if err != nil {
		a.failStartup(fmt.Errorf("open image cache: %w", err))
		return
	}
}

func (a *Api) Login() error {
	a.loginMu.Lock()
	defer a.loginMu.Unlock()

	if a.isShuttingDown() {
		return context.Canceled
	}
	a.lifecycleMu.Lock()
	if a.startupErr != nil {
		err := a.startupErr
		a.lifecycleMu.Unlock()
		return err
	}
	if a.waClient == nil {
		a.lifecycleMu.Unlock()
		return errors.New("WhatsApp client is not ready")
	}
	if !a.eventHandlerSet {
		a.eventHandlerID = a.waClient.AddEventHandler(a.mainEventHandler)
		a.eventHandlerSet = true
	}
	client := a.waClient
	a.lifecycleMu.Unlock()

	if client.Store.ID == nil {
		loginCtx, cancel := context.WithCancel(a.ctx)
		a.lifecycleMu.Lock()
		a.loginCancel = cancel
		a.lifecycleMu.Unlock()
		defer func() {
			cancel()
			a.lifecycleMu.Lock()
			a.loginCancel = nil
			a.lifecycleMu.Unlock()
		}()

		qrChan, err := client.GetQRChannel(loginCtx)
		if err != nil {
			return fmt.Errorf("create QR login channel: %w", err)
		}
		if a.isShuttingDown() {
			return context.Canceled
		}
		err = client.Connect()
		if err != nil {
			return err
		}
		for {
			select {
			case <-loginCtx.Done():
				return loginCtx.Err()
			case evt, ok := <-qrChan:
				if !ok {
					return nil
				}
				if evt.Event == "code" {
					runtime.EventsEmit(a.ctx, "wa:qr", evt.Code)
				} else {
					runtime.EventsEmit(a.ctx, "wa:status", evt.Event)
				}
			}
		}
	} else {
		if client.Store.ID != nil && a.messageStore != nil {
			a.messageStore.SetSelfUser(client.Store.ID.User)
		}
		// Already logged in, connect before announcing readiness.
		err := client.Connect()
		if err != nil {
			return err
		}
		if a.isShuttingDown() {
			return context.Canceled
		}
		runtime.EventsEmit(a.ctx, "wa:status", "logged_in")
	}
	return nil
}

func (a *Api) mainEventHandler(evt any) {
	a.eventMu.RLock()
	defer a.eventMu.RUnlock()
	if a.isShuttingDown() {
		return
	}
	switch v := evt.(type) {
	case *events.Message:
		unwrapped := store.UnwrapMessage(v.Message)
		if unwrapped == nil {
			return
		}

		var parsedHTML string
		var isEditMessage bool
		var editTargetID string
		var editContent *waE2E.Message

		// 1. Check SecretEncryptedMessage first (modern WhatsApp encrypted message edit)
		var encMessage *waE2E.SecretEncryptedMessage
		if unwrapped.GetSecretEncryptedMessage() != nil {
			encMessage = unwrapped.GetSecretEncryptedMessage()
		} else if v.RawMessage != nil && v.RawMessage.GetSecretEncryptedMessage() != nil {
			encMessage = v.RawMessage.GetSecretEncryptedMessage()
		}

		if encMessage != nil && encMessage.GetSecretEncType() == waE2E.SecretEncryptedMessage_MESSAGE_EDIT {
			if a.waClient != nil {
				decrypted, err := a.waClient.DecryptSecretEncryptedMessage(a.ctx, v)
				if err != nil {
					log.Println("Failed to decrypt SecretEncryptedMessage edit:", err)
				} else if decrypted != nil {
					isEditMessage = true
					if encMessage.GetTargetMessageKey() != nil {
						editTargetID = encMessage.GetTargetMessageKey().GetID()
					}
					decryptedUnwrapped := store.UnwrapMessage(decrypted)
					if protoMsg := decryptedUnwrapped.GetProtocolMessage(); protoMsg != nil && protoMsg.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT {
						if protoMsg.GetKey() != nil && editTargetID == "" {
							editTargetID = protoMsg.GetKey().GetID()
						}
						editContent = store.UnwrapMessage(protoMsg.GetEditedMessage())
					} else {
						editContent = decryptedUnwrapped
					}
					if editContent != nil {
						parsedHTML = a.processMessageText(editContent)
					}
				}
			}
		}

		// 2. Check ProtocolMessage MESSAGE_EDIT
		if !isEditMessage {
			if protoMsg := unwrapped.GetProtocolMessage(); protoMsg != nil && protoMsg.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT {
				isEditMessage = true
				if protoMsg.GetKey() != nil {
					editTargetID = protoMsg.GetKey().GetID()
				}
				editContent = store.UnwrapMessage(protoMsg.GetEditedMessage())
				if editContent != nil {
					parsedHTML = a.processMessageText(editContent)
				}
			} else if v.RawMessage != nil {
				if rawUnwrapped := store.UnwrapMessage(v.RawMessage); rawUnwrapped != nil {
					if protoMsg := rawUnwrapped.GetProtocolMessage(); protoMsg != nil && protoMsg.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT {
						isEditMessage = true
						if protoMsg.GetKey() != nil {
							editTargetID = protoMsg.GetKey().GetID()
						}
						editContent = store.UnwrapMessage(protoMsg.GetEditedMessage())
						if editContent != nil {
							parsedHTML = a.processMessageText(editContent)
						}
					}
				}
			}
		}

		if parsedHTML == "" {
			if v.IsEdit {
				isEditMessage = true
			}
			parsedHTML = a.processMessageText(unwrapped)
		}

		myUser := a.GetMyJID()
		if myUser != "" && (v.Info.Sender.User == myUser || (!strings.Contains(v.Info.Chat.Server, "g.us") && v.Info.Chat.User == myUser)) {
			v.Info.IsFromMe = true
		}

		messageID := a.messageStore.ProcessMessageEventWithEdit(a.ctx, a.waClient.Store.LIDs, v, parsedHTML, editTargetID, editContent)

		// If a message was processed (inserted or updated), emit the decoded message from DB
		if messageID != "" {
			chatJID := v.Info.Chat
			if a.waClient != nil {
				chatJID = canonicalUserJID(a.ctx, a.waClient, chatJID)
			}
			updatedMsg, err := a.messageStore.GetDecodedMessage(chatJID.String(), messageID)
			if err == nil {
				runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
					"chatId":      chatJID.String(),
					"message":     updatedMsg,
					"messageText": parsedHTML, // Text field contains HTML now, but better than nothing or we can use updatedMsg.Text
					"timestamp":   v.Info.Timestamp.Unix(),
					"sender":      v.Info.PushName,
					"isFromMe":    v.Info.IsFromMe,
				})
			} else if !errors.Is(err, sql.ErrNoRows) {
				log.Println("Failed to get decoded message after processing:", err)
			}
		}

		// Raise a desktop notification for genuine incoming messages (not our
		// own, not reactions, not channel/broadcast posts) while backgrounded.
		// Respects the global notification switch and per-chat mutes
		// (including mutes synced from the phone).
		isFeed := v.Info.Chat.Server == types.NewsletterServer || v.Info.Chat.Server == types.BroadcastServer
		a.activeChatMu.RLock()
		isActiveChat := a.isSameChat(a.activeChatId, v.Info.Chat)
		a.activeChatMu.RUnlock()

		isLookingAtChat := a.windowFocused.Load() && isActiveChat
		if messageID != "" && !v.Info.IsFromMe && !isFeed && v.Message.GetReactionMessage() == nil &&
			!isLookingAtChat && store.GetNotificationsEnabled() && !a.messageStore.IsChatMuted(v.Info.Chat.String()) &&
			!a.messageStore.IsChatArchived(v.Info.Chat.String()) {
			a.startBackground(func() { a.notifyIncoming(v, parsedHTML, isEditMessage) })
		}

		if reaction := v.Message.GetReactionMessage(); reaction != nil {
			a.startBackground(func() {
				targetID := reaction.GetKey().GetID()
				targetMsg, err := a.messageStore.GetMessageWithMedia(v.Info.Chat.String(), targetID)
				if err != nil {
					log.Println("Failed", err)
					return
				}

				targetText := targetMsg.Text
				senderName := v.Info.PushName
				if senderName == "" && v.Info.Sender.User != "" {
					senderName = v.Info.Sender.User
				}
				if v.Info.IsFromMe {
					senderName = "You"
				}

				runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
					"chatId":      v.Info.Chat.String(),
					"message":     nil,
					"messageText": targetText,
					"reaction":    reaction.GetText(),
					"timestamp":   v.Info.Timestamp.Unix(),
					"sender":      senderName,
				})
			})
		}

	case *events.Picture:
		targetJID := v.JID.String()
		if v.Remove {
			if a.imageCache != nil {
				_ = a.imageCache.DeleteAvatar(targetJID)
				if canon := canonicalUserJID(a.ctx, a.waClient, v.JID).String(); canon != targetJID {
					_ = a.imageCache.DeleteAvatar(canon)
				}
			}
			runtime.EventsEmit(a.ctx, "wa:picture_update", targetJID)
		} else {
			a.startBackground(func() {
				_, _ = a.GetCachedAvatar(targetJID, true)
				runtime.EventsEmit(a.ctx, "wa:picture_update", targetJID)
				if canon := canonicalUserJID(a.ctx, a.waClient, v.JID).String(); canon != targetJID {
					runtime.EventsEmit(a.ctx, "wa:picture_update", canon)
				}
			})
		}

	case *events.Mute:
		// Emitted for mutes set on other devices (e.g. the phone), including
		// during app-state full sync. Persist so notifications stay quiet.
		muted := v.Action.GetMuted()
		a.handleMuteEvent(v.JID, muted, v.Action.GetMuteEndTimestamp())

	case *events.Connected:
		if a.waClient.Store.ID != nil && a.messageStore != nil {
			a.messageStore.SetSelfUser(a.waClient.Store.ID.User)
		}
		// For new logins, there might be a problem where the whatsmeow client
		// gets a 515 code which gets resolved internally by auto-reconnecting
		// in a separate goroutine. In that case, the Initialise call below for
		// the AppDatabase will be executed first without the client even logging
		// in (which is the reason why the groups fetch fails and there are no
		// groups in the app until a manual reinitialize is done). To avoid that,
		// wait here until logged in.
		if err := a.cw.Initialise(a.waClient); err != nil {
			log.Println("group database initialization failed:", err)
		}
		// Heal group rows with missing/empty names in the background now
		// that the client can reach the server.
		a.startBackground(a.repairGroupNames)
		// Recover archive/pin/mute sync if the local app state is corrupted.
		a.startBackground(a.resyncAppState)
		if err := a.waClient.SendPresence(a.ctx, types.PresenceAvailable); err != nil {
			log.Println("failed to send available presence:", err)
		}
		// Run migration for messages.db
		err := a.messageStore.MigrateLIDToPN(a.ctx, a.waClient.Store.LIDs)
		if err != nil {
			log.Println("Messages DB migration failed:", err)
		} else {
			log.Println("Messages DB migration completed successfully")
			runtime.EventsEmit(a.ctx, "wa:chat_list_refresh")
		}
	case *events.HistorySync:
		// whatsmeow delivers past conversations here after linking. Reuse the
		// same storage path as live messages so chats/history populate the UI.
		a.processHistorySync(v)
	case *events.Archive:
		// Chat archived/unarchived from another device (or app state sync).
		if err := a.messageStore.SetChatArchived(v.JID.String(), v.Action.GetArchived(), v.Timestamp.Unix()); err != nil {
			log.Println("Failed to store chat archive state:", err)
		}
		runtime.EventsEmit(a.ctx, "wa:chat_list_refresh")
	case *events.Pin:
		// Chat pinned/unpinned from another device (or during app state sync).
		if err := a.messageStore.SetChatPinned(v.JID.String(), v.Action.GetPinned(), v.Timestamp.Unix()); err != nil {
			log.Println("Failed to store chat pin:", err)
		}
		runtime.EventsEmit(a.ctx, "wa:chat_list_refresh")
	case *events.Disconnected:
		a.waClient.SendPresence(a.ctx, types.PresenceUnavailable)
	case *events.Receipt:
		var status string
		switch v.Type {
		case types.ReceiptTypeRead, types.ReceiptTypeReadSelf, types.ReceiptTypePlayed, types.ReceiptTypePlayedSelf:
			status = "read"
		case types.ReceiptTypeDelivered, types.ReceiptTypeSender:
			status = "delivered"
		}

		if status != "" && len(v.MessageIDs) > 0 {
			msgIDs := make([]string, len(v.MessageIDs))
			for i, id := range v.MessageIDs {
				msgIDs[i] = string(id)
			}
			if a.messageStore != nil {
				_ = a.messageStore.UpdateDeliveryStatus(msgIDs, status)
			}
			runtime.EventsEmit(a.ctx, "wa:message_receipt", map[string]any{
				"chatId":     v.Chat.String(),
				"messageIds": msgIDs,
				"status":     status,
			})
		}
	default:
		// Ignore other events for now
	}

}

// processHistorySync stores the messages contained in a whatsmeow HistorySync
// event. WhatsApp sends these in several batches after a device is linked
// (bootstrap, recent, full). Each conversation's WebMessageInfo entries are
// converted into the same *events.Message shape that live messages use, then
// persisted through the existing MessageStore so the chat list and history
// render exactly like incoming messages do.
func (a *Api) processHistorySync(v *events.HistorySync) {
	conversations := v.Data.GetConversations()
	if len(conversations) == 0 {
		return
	}
	stored := 0
	for _, conv := range conversations {
		chatJID, err := types.ParseJID(conv.GetID())
		if err != nil {
			continue
		}
		for _, histMsg := range conv.GetMessages() {
			webMsg := histMsg.GetMessage()
			if webMsg == nil {
				continue
			}
			parsedMsg, err := a.waClient.ParseWebMessage(chatJID, webMsg)
			if err != nil || parsedMsg.Message == nil {
				continue
			}
			// ParseWebMessage doesn't unwrap containers (ephemeral/view-once)
			// like the live path does, so do it here or the content is lost.
			parsedMsg.Message = store.UnwrapMessage(parsedMsg.Message)
			if parsedMsg.Message == nil {
				continue
			}
			parsedHTML := a.processMessageText(parsedMsg.Message)
			myUser := a.GetMyJID()
			if myUser != "" && (parsedMsg.Info.Sender.User == myUser || (!strings.Contains(parsedMsg.Info.Chat.Server, "g.us") && parsedMsg.Info.Chat.User == myUser)) {
				parsedMsg.Info.IsFromMe = true
			}
			if a.messageStore.ProcessMessageEvent(a.ctx, a.waClient.Store.LIDs, parsedMsg, parsedHTML) != "" {
				stored++
			}
		}
	}
	log.Printf("History sync: stored %d messages from %d conversations", stored, len(conversations))
	a.emit("wa:chat_list_refresh")
}

func (a *Api) emit(event string, data ...any) {
	if a.ctx == nil || a.ctx.Value("events") == nil {
		return
	}
	runtime.EventsEmit(a.ctx, event, data...)
}


