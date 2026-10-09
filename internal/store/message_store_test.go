package store

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/query"
	"github.com/polymorfa/hypermeow/proto/waCommon"
	"github.com/polymorfa/hypermeow/proto/waE2E"
	"github.com/polymorfa/hypermeow/types"
	"github.com/polymorfa/hypermeow/types/events"
	"google.golang.org/protobuf/proto"
)

func newTestMessageStore(t *testing.T) *MessageStore {
	t.Helper()
	oldConfigDir := misc.ConfigDir
	misc.ConfigDir = t.TempDir()
	t.Cleanup(func() { misc.ConfigDir = oldConfigDir })

	ms, err := NewMessageStore()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ms.Close() })
	return ms
}

func insertTestMessage(t *testing.T, ms *MessageStore, id, chat string, timestamp int64, replyTo string) {
	t.Helper()
	err := ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(
			query.InsertMessage,
			id,
			chat,
			"sender@s.whatsapp.net",
			timestamp,
			false,
			id,
			false,
			replyTo,
			false,
			false,
			0,
		)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func messageIDs(messages []DecodedMessage) []string {
	ids := make([]string, len(messages))
	for i := range messages {
		ids[i] = messages[i].Info.ID
	}
	return ids
}

func TestMessagePaginationUsesStableCompoundCursor(t *testing.T) {
	ms := newTestMessageStore(t)
	const (
		chat      = "123@s.whatsapp.net"
		timestamp = int64(1_700_000_000)
	)
	for _, id := range []string{"a", "b", "c", "d", "e"} {
		insertTestMessage(t, ms, id, chat, timestamp, "")
	}

	first, err := ms.GetDecodedMessagesPaged(chat, 0, "", 2)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ms.GetDecodedMessagesPaged(chat, timestamp, first[0].Info.ID, 2)
	if err != nil {
		t.Fatal(err)
	}
	third, err := ms.GetDecodedMessagesPaged(chat, timestamp, second[0].Info.ID, 2)
	if err != nil {
		t.Fatal(err)
	}

	got := append(append(messageIDs(third), messageIDs(second)...), messageIDs(first)...)
	want := []string{"a", "b", "c", "d", "e"}
	if len(got) != len(want) {
		t.Fatalf("got IDs %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got IDs %v, want %v", got, want)
		}
	}
}

func TestPagedQuotedMessagesAreShallow(t *testing.T) {
	ms := newTestMessageStore(t)
	const chat = "123@s.whatsapp.net"
	insertTestMessage(t, ms, "a", chat, 1, "b")
	insertTestMessage(t, ms, "b", chat, 2, "a")

	messages, err := ms.GetDecodedMessagesPaged(chat, 0, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 {
		t.Fatalf("got %d messages, want 2", len(messages))
	}
	for _, message := range messages {
		contextInfo := message.Content.ExtendedTextMessage.ContextInfo
		if contextInfo == nil || contextInfo.QuotedMessage == nil {
			t.Fatalf("message %s has no quoted summary", message.Info.ID)
		}
		if contextInfo.QuotedMessage.ExtendedTextMessage != nil {
			t.Fatalf("message %s recursively decoded its quoted message", message.Info.ID)
		}
	}
}

func TestDecodedMessagesIncludeLinkPreviewMetadata(t *testing.T) {
	ms := newTestMessageStore(t)
	const (
		chat = "123@s.whatsapp.net"
		id   = "preview-message"
	)
	insertTestMessage(t, ms, id, chat, 1, "")
	err := ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(
			query.InsertLinkPreview,
			id,
			"https://example.com/article",
			"Example title",
			"Example description",
			[]byte{1, 2, 3},
			"",
			nil,
			nil,
			nil,
		)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	page, err := ms.GetDecodedMessagesPaged(chat, 0, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(page) != 1 || page[0].LinkPreview == nil {
		t.Fatalf("paged message has no link preview: %#v", page)
	}
	preview := page[0].LinkPreview
	if preview.URL != "https://example.com/article" || preview.Title != "Example title" || !preview.HasPoster {
		t.Fatalf("unexpected paged preview: %#v", preview)
	}

	message, err := ms.GetDecodedMessage(chat, id)
	if err != nil {
		t.Fatal(err)
	}
	if message.LinkPreview == nil || !message.LinkPreview.HasPoster {
		t.Fatalf("single decoded message has no poster metadata: %#v", message.LinkPreview)
	}
}

func TestRunSyncReturnsCommitFailure(t *testing.T) {
	ms := newTestMessageStore(t)
	err := ms.runSync(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`PRAGMA defer_foreign_keys=ON`); err != nil {
			return err
		}
		_, err := tx.Exec(
			`INSERT INTO reactions (message_id, sender_id, emoji) VALUES (?, ?, ?)`,
			"missing-message",
			"sender",
			"👍",
		)
		return err
	})
	if err == nil {
		t.Fatal("runSync returned success for a transaction that failed at commit")
	}
}

func TestRunSyncReturnsBeginFailureWithoutBlocking(t *testing.T) {
	ms := newTestMessageStore(t)
	if err := ms.db.Close(); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		done <- ms.runSync(func(*sql.Tx) error { return nil })
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("runSync returned success after the database was closed")
		}
	case <-time.After(time.Second):
		t.Fatal("runSync blocked after transaction begin failed")
	}
}

func TestGetMessageWithMediaByID(t *testing.T) {
	ms := newTestMessageStore(t)
	const (
		chat = "123@s.whatsapp.net"
		id   = "media-msg-1"
	)
	err := ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(
			query.InsertMessage,
			id,
			chat,
			"sender@s.whatsapp.net",
			int64(1_700_000_000),
			false,
			"",
			true,
			"",
			false,
			false,
			1,
		)
		if err != nil {
			return err
		}
		_, err = tx.Exec(
			query.InsertMessageMedia,
			id,
			1,
			"https://example.com/image.jpg",
			"image/jpeg",
			"/direct/path",
			[]byte("key"),
			[]byte("sha"),
			[]byte("encsha"),
			100,
			200,
			"test.jpg",
			0,
			nil,
		)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	msg, err := ms.GetMessageWithMediaByID(id)
	if err != nil {
		t.Fatalf("GetMessageWithMediaByID failed: %v", err)
	}
	if msg == nil || msg.Media == nil {
		t.Fatalf("expected message with media, got %#v", msg)
	}
	if msg.Media.GetFileName() != "test.jpg" {
		t.Fatalf("expected test.jpg, got %s", msg.Media.GetFileName())
	}
}

func TestAntiDeletePreservesMessage(t *testing.T) {
	ms := newTestMessageStore(t)
	const (
		chat = "123@s.whatsapp.net"
		id   = "msg-anti-delete"
		text = "Secret text that should not be deleted"
	)

	err := ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(
			query.InsertMessage,
			id, chat, "sender@s.whatsapp.net", int64(1_700_000_000),
			false, text, false, "", false, false, 0,
		)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	// Mark deleted (revoke)
	if err := ms.MarkMessageDeleted(id); err != nil {
		t.Fatalf("MarkMessageDeleted failed: %v", err)
	}

	decoded, err := ms.GetDecodedMessage(chat, id)
	if err != nil {
		t.Fatalf("GetDecodedMessage failed: %v", err)
	}

	if !decoded.IsDeleted {
		t.Errorf("expected IsDeleted to be true, got %v", decoded.IsDeleted)
	}
	if decoded.Content == nil || decoded.Content.Conversation != `<i>🚫 This message was deleted</i>` {
		t.Errorf("expected deleted placeholder, got %#v", decoded.Content)
	}
}

func TestUpdateDeliveryStatus(t *testing.T) {
	ms := newTestMessageStore(t)
	const (
		chat = "123@s.whatsapp.net"
		id   = "msg-delivery-status"
	)

	err := ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(
			query.InsertMessage,
			id, chat, "sender@s.whatsapp.net", int64(1_700_000_000),
			true, "Hello", false, "", false, false, 0,
		)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	// Initial default status should be "sent"
	decoded, err := ms.GetDecodedMessage(chat, id)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.DeliveryStatus != "sent" {
		t.Errorf("expected initial status 'sent', got %q", decoded.DeliveryStatus)
	}

	// Upgrade to delivered
	if err := ms.UpdateDeliveryStatus([]string{id}, "delivered"); err != nil {
		t.Fatal(err)
	}
	decoded, _ = ms.GetDecodedMessage(chat, id)
	if decoded.DeliveryStatus != "delivered" {
		t.Errorf("expected status 'delivered', got %q", decoded.DeliveryStatus)
	}

	// Upgrade to read
	if err := ms.UpdateDeliveryStatus([]string{id}, "read"); err != nil {
		t.Fatal(err)
	}
	decoded, _ = ms.GetDecodedMessage(chat, id)
	if decoded.DeliveryStatus != "read" {
		t.Errorf("expected status 'read', got %q", decoded.DeliveryStatus)
	}

	// Attempt downgrade to delivered should be ignored
	if err := ms.UpdateDeliveryStatus([]string{id}, "delivered"); err != nil {
		t.Fatal(err)
	}
	decoded, _ = ms.GetDecodedMessage(chat, id)
	if decoded.DeliveryStatus != "read" {
		t.Errorf("expected status to remain 'read', got %q", decoded.DeliveryStatus)
	}
}

func TestMessageEditLogging(t *testing.T) {
	ms := newTestMessageStore(t)
	const (
		chat = "123@s.whatsapp.net"
		id   = "msg-edit-test"
	)

	err := ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(
			query.InsertMessage,
			id, chat, "sender@s.whatsapp.net", int64(1_700_000_000),
			true, "Original text", false, "", false, false, 0,
		)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	// 1. Initial message state
	decoded, err := ms.GetDecodedMessage(chat, id)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Edited {
		t.Errorf("expected Edited to be false initially")
	}

	// 2. Perform first edit
	edit1 := &waE2E.Message{Conversation: proto.String("First edit")}
	if err := ms.UpdateMessageContent(nil, id, edit1, "First edit", 1_700_000_100); err != nil {
		t.Fatalf("UpdateMessageContent 1 failed: %v", err)
	}

	decoded, err = ms.GetDecodedMessage(chat, id)
	if err != nil {
		t.Fatal(err)
	}
	if !decoded.Edited {
		t.Errorf("expected Edited to be true after first edit")
	}
	if decoded.Content.Conversation != "First edit" {
		t.Errorf("expected current conversation %q, got %q", "First edit", decoded.Content.Conversation)
	}

	// 3. Perform second edit
	edit2 := &waE2E.Message{Conversation: proto.String("Second edit")}
	if err := ms.UpdateMessageContent(nil, id, edit2, "Second edit", 1_700_000_200); err != nil {
		t.Fatalf("UpdateMessageContent 2 failed: %v", err)
	}

	decoded, err = ms.GetDecodedMessage(chat, id)
	if err != nil {
		t.Fatal(err)
	}
	if !decoded.Edited {
		t.Errorf("expected Edited to remain true after second edit")
	}
	if decoded.Content.Conversation != "Second edit" {
		t.Errorf("expected current conversation %q, got %q", "Second edit", decoded.Content.Conversation)
	}

	// 4. Verify batch hydration via GetDecodedMessagesPaged
	paged, err := ms.GetDecodedMessagesPaged(chat, 0, "", 10)
	if err != nil {
		t.Fatalf("GetDecodedMessagesPaged failed: %v", err)
	}
	if len(paged) != 1 {
		t.Fatalf("expected 1 paged message, got %d", len(paged))
	}
	if !paged[0].Edited {
		t.Errorf("expected paged message to be marked edited")
	}
}

func TestProcessMessageEventWrappedEditTwice(t *testing.T) {
	ms := newTestMessageStore(t)
	chatJID, _ := types.ParseJID("123@s.whatsapp.net")
	const origID = "orig-msg-123"

	// 1. Store initial message
	initialMsgEvent := &events.Message{
		Info: types.MessageInfo{
			ID:        origID,
			Timestamp: time.Unix(1_700_000_000, 0),
			MessageSource: types.MessageSource{
				Chat:     chatJID,
				Sender:   chatJID,
				IsFromMe: false,
			},
		},
		Message: &waE2E.Message{
			Conversation: proto.String("Paraparapara,perepere"),
		},
	}
	resID := ms.ProcessMessageEvent(context.Background(), nil, initialMsgEvent, "Paraparapara,perepere")
	if resID != origID {
		t.Fatalf("expected initial message ID %q, got %q", origID, resID)
	}

	// 2. Incoming first edit wrapped in EditedMessage (standard WhatsApp format)
	edit1Wrapped := &waE2E.Message{
		EditedMessage: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{
				ProtocolMessage: &waE2E.ProtocolMessage{
					Key: &waCommon.MessageKey{
						ID: proto.String(origID),
					},
					Type: waE2E.ProtocolMessage_MESSAGE_EDIT.Enum(),
					EditedMessage: &waE2E.Message{
						Conversation: proto.String("First revision"),
					},
				},
			},
		},
	}
	edit1Event := &events.Message{
		Info: types.MessageInfo{
			ID:        "edit-msg-event-1",
			Timestamp: time.Unix(1_700_000_060, 0),
			MessageSource: types.MessageSource{
				Chat:     chatJID,
				Sender:   chatJID,
				IsFromMe: false,
			},
		},
		Message: edit1Wrapped,
	}

	editRes1 := ms.ProcessMessageEvent(context.Background(), nil, edit1Event, "First revision")
	if editRes1 != origID {
		t.Fatalf("expected ProcessMessageEvent to return target ID %q, got %q", origID, editRes1)
	}

	// Ensure NO new phantom message row was inserted for edit-msg-event-1
	if _, err := ms.GetDecodedMessage(chatJID.String(), "edit-msg-event-1"); err == nil {
		t.Errorf("phantom message row was unexpectedly inserted for edit-msg-event-1")
	}

	// Verify original message is updated
	msg1, err := ms.GetDecodedMessage(chatJID.String(), origID)
	if err != nil {
		t.Fatalf("failed to get decoded message: %v", err)
	}
	if !msg1.Edited {
		t.Errorf("expected Edited to be true")
	}
	if msg1.Content.Conversation != "First revision" {
		t.Errorf("expected text %q, got %q", "First revision", msg1.Content.Conversation)
	}

	// 3. Incoming second edit wrapped in EditedMessage
	edit2Wrapped := &waE2E.Message{
		EditedMessage: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{
				ProtocolMessage: &waE2E.ProtocolMessage{
					Key: &waCommon.MessageKey{
						ID: proto.String(origID),
					},
					Type: waE2E.ProtocolMessage_MESSAGE_EDIT.Enum(),
					EditedMessage: &waE2E.Message{
						Conversation: proto.String("Second revision final"),
					},
				},
			},
		},
	}
	edit2Event := &events.Message{
		Info: types.MessageInfo{
			ID:        "edit-msg-event-2",
			Timestamp: time.Unix(1_700_000_120, 0),
			MessageSource: types.MessageSource{
				Chat:     chatJID,
				Sender:   chatJID,
				IsFromMe: false,
			},
		},
		Message: edit2Wrapped,
	}

	editRes2 := ms.ProcessMessageEvent(context.Background(), nil, edit2Event, "Second revision final")
	if editRes2 != origID {
		t.Fatalf("expected ProcessMessageEvent to return target ID %q, got %q", origID, editRes2)
	}

	// Ensure NO new phantom message row was inserted for edit-msg-event-2
	if _, err := ms.GetDecodedMessage(chatJID.String(), "edit-msg-event-2"); err == nil {
		t.Errorf("phantom message row was unexpectedly inserted for edit-msg-event-2")
	}

	// Verify original message is updated
	msg2, err := ms.GetDecodedMessage(chatJID.String(), origID)
	if err != nil {
		t.Fatalf("failed to get decoded message: %v", err)
	}
	if !msg2.Edited {
		t.Errorf("expected Edited to remain true")
	}
	if msg2.Content.Conversation != "Second revision final" {
		t.Errorf("expected text %q, got %q", "Second revision final", msg2.Content.Conversation)
	}
}

func TestProcessMessageEventWhatsmeowUnwrappedEdit(t *testing.T) {
	ms := newTestMessageStore(t)

	chatJID := types.NewJID("1234567890", types.DefaultUserServer)
	origID := "whatsmeow-orig-123"

	// 1. Initial message
	initialEvent := &events.Message{
		Info: types.MessageInfo{
			ID:        origID,
			Timestamp: time.Unix(1_700_000_000, 0),
			MessageSource: types.MessageSource{
				Chat:   chatJID,
				Sender: chatJID,
			},
		},
		Message: &waE2E.Message{
			Conversation: proto.String("Hello world"),
		},
	}
	ms.ProcessMessageEvent(context.Background(), nil, initialEvent, "Hello world")

	// 2. Whatsmeow unwrapped edit: client.go sets IsEdit = true, Info.ID = targetID, Message = new content
	editEvent := &events.Message{
		Info: types.MessageInfo{
			ID:        origID,
			Timestamp: time.Unix(1_700_000_050, 0),
			MessageSource: types.MessageSource{
				Chat:   chatJID,
				Sender: chatJID,
			},
		},
		Message: &waE2E.Message{
			Conversation: proto.String("Hello world edited"),
		},
		IsEdit: true,
	}

	resID := ms.ProcessMessageEvent(context.Background(), nil, editEvent, "Hello world edited")
	if resID != origID {
		t.Fatalf("expected ProcessMessageEvent to return %q, got %q", origID, resID)
	}

	decoded, err := ms.GetDecodedMessage(chatJID.String(), origID)
	if err != nil {
		t.Fatalf("failed to get decoded message: %v", err)
	}
	if !decoded.Edited {
		t.Errorf("expected Edited to be true")
	}
	if decoded.Content.Conversation != "Hello world edited" {
		t.Errorf("expected conversation %q, got %q", "Hello world edited", decoded.Content.Conversation)
	}
}

func TestLiveIncomingMessageEditWithProtocolMessageAndIsEditTrue(t *testing.T) {
	ms := newTestMessageStore(t)

	chatJID := types.NewJID("1234567890", types.DefaultUserServer)
	origID := "original-live-msg-id"

	// 1. Initial message inserted
	initialEvent := &events.Message{
		Info: types.MessageInfo{
			ID:        origID,
			Timestamp: time.Unix(1_700_000_000, 0),
			MessageSource: types.MessageSource{
				Chat:   chatJID,
				Sender: chatJID,
			},
		},
		Message: &waE2E.Message{
			Conversation: proto.String("Live initial message"),
		},
	}
	resID := ms.ProcessMessageEvent(context.Background(), nil, initialEvent, "Live initial message")
	if resID != origID {
		t.Fatalf("expected initial message ID %q, got %q", origID, resID)
	}

	// 2. Live incoming edit where whatsmeow sets IsEdit=true on unwrapping EditedMessage,
	// but Info.ID is the edit stanza ID and Message contains ProtocolMessage.
	editStanzaID := "edit-protocol-stanza-id-999"
	liveEditEvent := &events.Message{
		Info: types.MessageInfo{
			ID:        editStanzaID,
			Timestamp: time.Unix(1_700_000_080, 0),
			MessageSource: types.MessageSource{
				Chat:   chatJID,
				Sender: chatJID,
			},
		},
		Message: &waE2E.Message{
			ProtocolMessage: &waE2E.ProtocolMessage{
				Key: &waCommon.MessageKey{
					ID: proto.String(origID),
				},
				Type: waE2E.ProtocolMessage_MESSAGE_EDIT.Enum(),
				EditedMessage: &waE2E.Message{
					Conversation: proto.String("Live edited message revision"),
				},
				TimestampMS: proto.Int64(1_700_000_080_000),
			},
		},
		IsEdit: true,
	}

	editResID := ms.ProcessMessageEvent(context.Background(), nil, liveEditEvent, "Live edited message revision")
	if editResID != origID {
		t.Fatalf("expected ProcessMessageEvent to return target ID %q, got %q", origID, editResID)
	}

	decoded, err := ms.GetDecodedMessage(chatJID.String(), origID)
	if err != nil {
		t.Fatalf("failed to get decoded message: %v", err)
	}
	if !decoded.Edited {
		t.Errorf("expected Edited to be true")
	}
	if decoded.Content.Conversation != "Live edited message revision" {
		t.Errorf("expected conversation %q, got %q", "Live edited message revision", decoded.Content.Conversation)
	}
}

func TestProcessMessageEventWithExplicitEdit(t *testing.T) {
	ms := newTestMessageStore(t)

	chatJID := types.NewJID("1234567890", types.DefaultUserServer)
	senderJID := types.NewJID("1234567890", types.DefaultUserServer)
	origID := "TARGET_MSG_FOR_EXPLICIT_EDIT"

	initialEvent := &events.Message{
		Info: types.MessageInfo{
			ID:        origID,
			Timestamp: time.Unix(1_700_000_000, 0),
			MessageSource: types.MessageSource{
				Chat:     chatJID,
				Sender:   senderJID,
				IsFromMe: false,
			},
		},
		Message: &waE2E.Message{
			Conversation: proto.String("Original message before secret edit"),
		},
	}
	ms.ProcessMessageEvent(context.Background(), nil, initialEvent, "Original message before secret edit")

	secretEncryptedEditEvent := &events.Message{
		Info: types.MessageInfo{
			ID:        "SECRET_STANZA_ID",
			Timestamp: time.Unix(1_700_000_100, 0),
			MessageSource: types.MessageSource{
				Chat:     chatJID,
				Sender:   senderJID,
				IsFromMe: false,
			},
		},
		Message: &waE2E.Message{
			SecretEncryptedMessage: &waE2E.SecretEncryptedMessage{
				SecretEncType: waE2E.SecretEncryptedMessage_MESSAGE_EDIT.Enum(),
				TargetMessageKey: &waCommon.MessageKey{
					ID: proto.String(origID),
				},
			},
		},
	}

	decryptedContent := &waE2E.Message{
		Conversation: proto.String("Decrypted secret edited text"),
	}

	resID := ms.ProcessMessageEventWithEdit(context.Background(), nil, secretEncryptedEditEvent, "Decrypted secret edited text", origID, decryptedContent)
	if resID != origID {
		t.Fatalf("expected ProcessMessageEventWithEdit to return target ID %q, got %q", origID, resID)
	}

	decoded, err := ms.GetDecodedMessage(chatJID.String(), origID)
	if err != nil {
		t.Fatalf("failed to get decoded message: %v", err)
	}
	if !decoded.Edited {
		t.Errorf("expected Edited to be true")
	}
	if decoded.Content.Conversation != "Decrypted secret edited text" {
		t.Errorf("expected conversation %q, got %q", "Decrypted secret edited text", decoded.Content.Conversation)
	}
}

func TestChatArchiveAndLatestMessage(t *testing.T) {
	ms := newTestMessageStore(t)
	const chat = "chat123@s.whatsapp.net"

	if ms.IsChatArchived(chat) {
		t.Fatalf("expected chat not to be archived initially")
	}

	if err := ms.SetChatArchived(chat, true, 1_700_000_500); err != nil {
		t.Fatalf("SetChatArchived(true) failed: %v", err)
	}
	if !ms.IsChatArchived(chat) {
		t.Fatalf("expected chat to be archived")
	}

	archivedMap := ms.GetArchivedChats()
	if archivedMap[chat] != 1_700_000_500 {
		t.Fatalf("expected archived timestamp 1700000500, got %d", archivedMap[chat])
	}

	// Insert message and check GetLatestMessageForChat
	const msgID = "msg-latest-test"
	err := ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(
			query.InsertMessage,
			msgID, chat, "sender@s.whatsapp.net", int64(1_700_000_999),
			false, "Hello there", false, "", false, false, 0,
		)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	id, ts, fromMe, sender, ok := ms.GetLatestMessageForChat(chat)
	if !ok {
		t.Fatalf("expected latest message to be found")
	}
	if id != msgID || ts != 1_700_000_999 || fromMe || sender != "sender@s.whatsapp.net" {
		t.Fatalf("unexpected message details: id=%q, ts=%d, fromMe=%v, sender=%q", id, ts, fromMe, sender)
	}

	// Unarchive
	if err := ms.SetChatArchived(chat, false, 0); err != nil {
		t.Fatalf("SetChatArchived(false) failed: %v", err)
	}
	if ms.IsChatArchived(chat) {
		t.Fatalf("expected chat to no longer be archived")
	}
}




