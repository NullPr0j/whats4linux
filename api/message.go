package api

import (
	"encoding/base64"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/lugvitc/whats4linux/internal/markdown"
	"github.com/lugvitc/whats4linux/internal/store"
	mtypes "github.com/lugvitc/whats4linux/internal/types"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/proto/waCommon"
	"github.com/polymorfa/hypermeow/proto/waE2E"
	"github.com/polymorfa/hypermeow/types"
	"github.com/polymorfa/hypermeow/types/events"
	"google.golang.org/protobuf/proto"
)

type MessageContent struct {
	Type            string   `json:"type"`
	Text            string   `json:"text,omitempty"`
	Base64Data      string   `json:"base64Data,omitempty"`
	Mimetype        string   `json:"mimetype,omitempty"`
	FileName        string   `json:"fileName,omitempty"`
	QuotedMessageID string   `json:"quotedMessageId,omitempty"`
	Mentions        []string `json:"mentions,omitempty"`
	ClientTempID    string   `json:"clientTempId,omitempty"`
	Ptt             bool     `json:"ptt,omitempty"`
	Seconds         uint32   `json:"seconds,omitempty"`
}

func (a *Api) processMessageText(msg *waE2E.Message) string {
	if msg == nil {
		return ""
	}
	var text string
	var mentionedJIDs []string

	if msg.GetConversation() != "" {
		text = msg.GetConversation()
	} else if msg.GetExtendedTextMessage() != nil {
		text = msg.GetExtendedTextMessage().GetText()
		if msg.GetExtendedTextMessage().GetContextInfo() != nil {
			mentionedJIDs = msg.GetExtendedTextMessage().GetContextInfo().GetMentionedJID()
		}
	} else {
		switch {
		case msg.GetImageMessage() != nil:
			text = msg.GetImageMessage().GetCaption()
			if msg.GetImageMessage().GetContextInfo() != nil {
				mentionedJIDs = msg.GetImageMessage().GetContextInfo().GetMentionedJID()
			}
		case msg.GetVideoMessage() != nil:
			text = msg.GetVideoMessage().GetCaption()
			if msg.GetVideoMessage().GetContextInfo() != nil {
				mentionedJIDs = msg.GetVideoMessage().GetContextInfo().GetMentionedJID()
			}
		case msg.GetDocumentMessage() != nil:
			text = msg.GetDocumentMessage().GetCaption()
			if msg.GetDocumentMessage().GetContextInfo() != nil {
				mentionedJIDs = msg.GetDocumentMessage().GetContextInfo().GetMentionedJID()
			}
		}
	}

	if text == "" {
		return ""
	}

	// First convert Markdown to HTML (which handles escaping)
	htmlText := markdown.MarkdownLinesToHTML(text)

	// Then replace mentions in the HTML
	if len(mentionedJIDs) > 0 {
		htmlText = replaceMentions(htmlText, mentionedJIDs, a)
	}

	return htmlText
}

func (a *Api) FetchMessagesPaged(jid string, limit int, beforeTimestamp int64, beforeMessageID string) ([]store.DecodedMessage, error) {
	messages, err := a.messageStore.GetDecodedMessagesPaged(jid, beforeTimestamp, beforeMessageID, limit)
	if err != nil {
		return nil, err
	}
	return messages, nil
}

func buildQuotedMessage(msg *store.ExtendedMessage) *waE2E.Message {
	if msg == nil {
		return nil
	}
	cleanText := markdown.HTMLToPlainText(msg.Text)
	var quotedMessage waE2E.Message

	if msg.Media == nil {
		quotedMessage.Conversation = proto.String(cleanText)
		return &quotedMessage
	}

	switch msg.Media.GetMediaGeneralType() {
	case mtypes.MediaTypeImage:
		width, height := msg.Media.GetDimensions()
		quotedMessage.ImageMessage = &waE2E.ImageMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			Caption:       proto.String(cleanText),
			FileSHA256:    msg.Media.GetFileSHA256(),
			Width:         proto.Uint32(uint32(width)),
			Height:        proto.Uint32(uint32(height)),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
		}
	case mtypes.MediaTypeVideo:
		quotedMessage.VideoMessage = &waE2E.VideoMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			Caption:       proto.String(cleanText),
			FileSHA256:    msg.Media.GetFileSHA256(),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
		}
	case mtypes.MediaTypeAudio:
		quotedMessage.AudioMessage = &waE2E.AudioMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			FileSHA256:    msg.Media.GetFileSHA256(),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
		}
	case mtypes.MediaTypeDocument:
		fileName := msg.Media.GetFileName()
		if fileName == "" {
			fileName = "Document"
		}
		quotedMessage.DocumentMessage = &waE2E.DocumentMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			Title:         proto.String(fileName),
			FileName:      proto.String(fileName),
			Caption:       proto.String(cleanText),
			FileSHA256:    msg.Media.GetFileSHA256(),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
		}
	case mtypes.MediaTypeSticker:
		quotedMessage.StickerMessage = &waE2E.StickerMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			FileSHA256:    msg.Media.GetFileSHA256(),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
		}
	default:
		quotedMessage.Conversation = proto.String(cleanText)
	}

	return &quotedMessage
}

func buildForwardedMessage(msg *store.ExtendedMessage) *waE2E.Message {
	if msg == nil {
		return nil
	}

	cleanText := markdown.HTMLToPlainText(msg.Text)

	contextInfo := &waE2E.ContextInfo{
		IsForwarded:     proto.Bool(true),
		ForwardingScore: proto.Uint32(1),
	}

	forwardedMsg := &waE2E.Message{}

	if msg.Media == nil {
		forwardedMsg.ExtendedTextMessage = &waE2E.ExtendedTextMessage{
			Text:        proto.String(cleanText),
			ContextInfo: contextInfo,
		}
		return forwardedMsg
	}

	switch msg.Media.GetMediaGeneralType() {
	case mtypes.MediaTypeImage:
		width, height := msg.Media.GetDimensions()
		forwardedMsg.ImageMessage = &waE2E.ImageMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			Caption:       proto.String(cleanText),
			FileSHA256:    msg.Media.GetFileSHA256(),
			Width:         proto.Uint32(uint32(width)),
			Height:        proto.Uint32(uint32(height)),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
			MediaKey:      msg.Media.GetMediaKey(),
			ContextInfo:   contextInfo,
		}
	case mtypes.MediaTypeVideo:
		forwardedMsg.VideoMessage = &waE2E.VideoMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			Caption:       proto.String(cleanText),
			FileSHA256:    msg.Media.GetFileSHA256(),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
			MediaKey:      msg.Media.GetMediaKey(),
			ContextInfo:   contextInfo,
		}
	case mtypes.MediaTypeAudio:
		forwardedMsg.AudioMessage = &waE2E.AudioMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			FileSHA256:    msg.Media.GetFileSHA256(),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
			MediaKey:      msg.Media.GetMediaKey(),
			ContextInfo:   contextInfo,
		}
	case mtypes.MediaTypeDocument:
		fileName := msg.Media.GetFileName()
		if fileName == "" {
			fileName = "Document"
		}
		forwardedMsg.DocumentMessage = &waE2E.DocumentMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			Title:         proto.String(fileName),
			FileName:      proto.String(fileName),
			Caption:       proto.String(cleanText),
			FileSHA256:    msg.Media.GetFileSHA256(),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
			MediaKey:      msg.Media.GetMediaKey(),
			ContextInfo:   contextInfo,
		}
	case mtypes.MediaTypeSticker:
		forwardedMsg.StickerMessage = &waE2E.StickerMessage{
			URL:           proto.String(msg.Media.GetURL()),
			Mimetype:      proto.String(msg.Media.GetMimetype()),
			FileSHA256:    msg.Media.GetFileSHA256(),
			FileEncSHA256: msg.Media.GetFileEncSHA256(),
			DirectPath:    proto.String(msg.Media.GetDirectPath()),
			MediaKey:      msg.Media.GetMediaKey(),
			ContextInfo:   contextInfo,
		}
	default:
		forwardedMsg.ExtendedTextMessage = &waE2E.ExtendedTextMessage{
			Text:        proto.String(cleanText),
			ContextInfo: contextInfo,
		}
	}

	return forwardedMsg
}

func (a *Api) buildQuotedContext(chatJID types.JID, quotedMessageID string) (*waE2E.ContextInfo, error) {
	if quotedMessageID == "" {
		return nil, nil
	}

	var msg *store.ExtendedMessage
	var err error
	if a.messageStore != nil {
		msg, err = a.messageStore.GetMessageWithMedia(chatJID.String(), quotedMessageID)
		if err != nil || msg == nil {
			msg, err = a.messageStore.GetMessageWithMediaByID(quotedMessageID)
		}
	}

	stanzaID := quotedMessageID
	contextInfo := &waE2E.ContextInfo{
		StanzaID: &stanzaID,
	}

	if msg != nil {
		contextInfo.QuotedMessage = buildQuotedMessage(msg)

		if chatJID.Server == types.GroupServer {
			if msg.Info.IsFromMe && a.waClient != nil && a.waClient.Store != nil && a.waClient.Store.ID != nil {
				contextInfo.Participant = proto.String(a.waClient.Store.ID.ToNonAD().String())
			} else if msg.Info.Sender.User != "" {
				contextInfo.Participant = proto.String(msg.Info.Sender.ToNonAD().String())
			}
		} else {
			if msg.Info.IsFromMe && a.waClient != nil && a.waClient.Store != nil && a.waClient.Store.ID != nil {
				contextInfo.Participant = proto.String(a.waClient.Store.ID.ToNonAD().String())
			} else {
				contextInfo.Participant = proto.String(chatJID.ToNonAD().String())
			}
		}
	} else {
		// Even if not in local store, populate participant for 1-on-1 chats
		if chatJID.Server != types.GroupServer {
			contextInfo.Participant = proto.String(chatJID.ToNonAD().String())
		}
	}

	return contextInfo, nil
}

// SendReaction reacts to a message with an emoji (empty emoji removes the
// reaction). senderJID is the original message's sender; empty means our own.
func (a *Api) SendReaction(chatJID, senderJID, messageID, emoji string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return err
	}
	sender := *a.waClient.Store.ID
	if senderJID != "" {
		if s, perr := types.ParseJID(senderJID); perr == nil {
			sender = s
		}
	}
	reactionMsg := a.waClient.BuildReaction(chat, sender, messageID, emoji)
	if _, err := a.waClient.SendMessage(a.ctx, chat, reactionMsg); err != nil {
		return err
	}
	// Persist our own reaction locally so it survives a reload.
	_ = a.messageStore.AddReactionToMessage(messageID, emoji, a.waClient.Store.ID.String())
	return nil
}

func (a *Api) SendMessage(chatJID string, content MessageContent) (string, error) {
	if a.waClient.Store.ID == nil {
		return "", fmt.Errorf("client not logged in")
	}

	parsedJID, err := types.ParseJID(chatJID)
	if err != nil {
		return "", err
	}

	var msgContent *waE2E.Message
	contextInfo, err := a.buildQuotedContext(parsedJID, content.QuotedMessageID)
	if err != nil {
		log.Println("Failed to build quoted context:", err)
		return "", err
	}

	switch content.Type {
	case "text":

		mentionedJIDs := content.Mentions

		// If we have mentions or quoted context, use ExtendedTextMessage
		if len(mentionedJIDs) > 0 || contextInfo != nil {
			if contextInfo == nil {
				contextInfo = &waE2E.ContextInfo{}
			}
			if len(mentionedJIDs) > 0 {
				contextInfo.MentionedJID = mentionedJIDs
			}
			msgContent = &waE2E.Message{
				ExtendedTextMessage: &waE2E.ExtendedTextMessage{
					Text:        &content.Text,
					ContextInfo: contextInfo,
				},
			}
		} else {
			msgContent = &waE2E.Message{
				Conversation: &content.Text,
			}
		}
	case "image":
		// Decode base64 image data
		imageData, err := base64.StdEncoding.DecodeString(content.Base64Data)
		if err != nil {
			return "", fmt.Errorf("failed to decode base64 image data: %v", err)
		}

		// Create image message
		mimeType := content.Mimetype
		if mimeType == "" {
			mimeType = "image/jpeg"
		}
		imageMsg := &waE2E.ImageMessage{
			Mimetype:      &mimeType,
			Caption:       &content.Text,
			JPEGThumbnail: nil, // We'll let WhatsApp generate the thumbnail
		}

		if len(content.Mentions) > 0 || contextInfo != nil {
			if contextInfo == nil {
				contextInfo = &waE2E.ContextInfo{}
			}
			if len(content.Mentions) > 0 {
				contextInfo.MentionedJID = content.Mentions
			}
			imageMsg.ContextInfo = contextInfo
		}

		// Upload the image
		uploaded, err := a.waClient.Upload(a.ctx, imageData, whatsmeow.MediaImage)
		if err != nil {
			return "", fmt.Errorf("failed to upload image: %v", err)
		}

		imageMsg.URL = &uploaded.URL
		imageMsg.DirectPath = &uploaded.DirectPath
		imageMsg.MediaKey = uploaded.MediaKey
		imageMsg.FileEncSHA256 = uploaded.FileEncSHA256
		imageMsg.FileSHA256 = uploaded.FileSHA256
		imageMsg.FileLength = &uploaded.FileLength

		msgContent = &waE2E.Message{
			ImageMessage: imageMsg,
		}
	case "video":
		// Decode base64 video data
		videoData, err := base64.StdEncoding.DecodeString(content.Base64Data)
		if err != nil {
			return "", fmt.Errorf("failed to decode base64 video data: %v", err)
		}

		// Create video message
		mimeType := content.Mimetype
		if mimeType == "" {
			mimeType = "video/mp4"
		}
		videoMsg := &waE2E.VideoMessage{
			Mimetype:      &mimeType,
			Caption:       &content.Text,
			JPEGThumbnail: nil, // We'll let WhatsApp generate the thumbnail
		}

		if len(content.Mentions) > 0 || contextInfo != nil {
			if contextInfo == nil {
				contextInfo = &waE2E.ContextInfo{}
			}
			if len(content.Mentions) > 0 {
				contextInfo.MentionedJID = content.Mentions
			}
			videoMsg.ContextInfo = contextInfo
		}

		// Upload the video
		uploaded, err := a.waClient.Upload(a.ctx, videoData, whatsmeow.MediaVideo)
		if err != nil {
			return "", fmt.Errorf("failed to upload video: %v", err)
		}

		videoMsg.URL = &uploaded.URL
		videoMsg.DirectPath = &uploaded.DirectPath
		videoMsg.MediaKey = uploaded.MediaKey
		videoMsg.FileEncSHA256 = uploaded.FileEncSHA256
		videoMsg.FileSHA256 = uploaded.FileSHA256
		videoMsg.FileLength = &uploaded.FileLength

		msgContent = &waE2E.Message{
			VideoMessage: videoMsg,
		}
	case "audio":
		// Decode base64 audio data
		audioData, err := base64.StdEncoding.DecodeString(content.Base64Data)
		if err != nil {
			return "", fmt.Errorf("failed to decode base64 audio data: %v", err)
		}

		// Create audio message
		mimeType := content.Mimetype
		if mimeType == "" {
			mimeType = "audio/ogg; codecs=opus"
		}
		audioMsg := &waE2E.AudioMessage{
			Mimetype: &mimeType,
			PTT:      proto.Bool(content.Ptt),
		}
		if content.Seconds > 0 {
			audioMsg.Seconds = proto.Uint32(content.Seconds)
		}

		if contextInfo != nil {
			audioMsg.ContextInfo = contextInfo
		}

		// Upload the audio
		uploaded, err := a.waClient.Upload(a.ctx, audioData, whatsmeow.MediaAudio)
		if err != nil {
			return "", fmt.Errorf("failed to upload audio: %v", err)
		}

		audioMsg.URL = &uploaded.URL
		audioMsg.DirectPath = &uploaded.DirectPath
		audioMsg.MediaKey = uploaded.MediaKey
		audioMsg.FileEncSHA256 = uploaded.FileEncSHA256
		audioMsg.FileSHA256 = uploaded.FileSHA256
		audioMsg.FileLength = &uploaded.FileLength

		msgContent = &waE2E.Message{
			AudioMessage: audioMsg,
		}
	case "document":
		// Decode base64 document data
		documentData, err := base64.StdEncoding.DecodeString(content.Base64Data)
		if err != nil {
			return "", fmt.Errorf("failed to decode base64 document data: %v", err)
		}

		// Create document message
		mimeType := content.Mimetype
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		fileName := strings.TrimSpace(content.FileName)
		if fileName == "" {
			fileName = "document"
		}
		documentMsg := &waE2E.DocumentMessage{
			Mimetype: &mimeType,
			FileName: &fileName,
			Caption:  &content.Text,
		}

		if len(content.Mentions) > 0 || contextInfo != nil {
			if contextInfo == nil {
				contextInfo = &waE2E.ContextInfo{}
			}
			if len(content.Mentions) > 0 {
				contextInfo.MentionedJID = content.Mentions
			}
			documentMsg.ContextInfo = contextInfo
		}

		// Upload the document
		uploaded, err := a.waClient.Upload(a.ctx, documentData, whatsmeow.MediaDocument)
		if err != nil {
			return "", fmt.Errorf("failed to upload document: %v", err)
		}

		documentMsg.URL = &uploaded.URL
		documentMsg.DirectPath = &uploaded.DirectPath
		documentMsg.MediaKey = uploaded.MediaKey
		documentMsg.FileEncSHA256 = uploaded.FileEncSHA256
		documentMsg.FileSHA256 = uploaded.FileSHA256
		documentMsg.FileLength = &uploaded.FileLength

		msgContent = &waE2E.Message{
			DocumentMessage: documentMsg,
		}
	case "sticker":
		// Decode base64 sticker data
		stickerData, err := base64.StdEncoding.DecodeString(content.Base64Data)
		if err != nil {
			return "", fmt.Errorf("failed to decode base64 sticker data: %v", err)
		}

		// Create sticker message
		mimeType := content.Mimetype
		if mimeType == "" {
			mimeType = "image/webp"
		}
		stickerMsg := &waE2E.StickerMessage{
			Mimetype: &mimeType,
		}

		// Upload the sticker
		uploaded, err := a.waClient.Upload(a.ctx, stickerData, whatsmeow.MediaImage) // Stickers use MediaImage
		if err != nil {
			return "", fmt.Errorf("failed to upload sticker: %v", err)
		}

		stickerMsg.URL = &uploaded.URL
		stickerMsg.DirectPath = &uploaded.DirectPath
		stickerMsg.MediaKey = uploaded.MediaKey
		stickerMsg.FileEncSHA256 = uploaded.FileEncSHA256
		stickerMsg.FileSHA256 = uploaded.FileSHA256
		stickerMsg.FileLength = &uploaded.FileLength

		msgContent = &waE2E.Message{
			StickerMessage: stickerMsg,
		}
	default:
		return "", fmt.Errorf("unsupported message type: %s", content.Type)
	}

	log.Printf("SendMessage Content: %+v\n", msgContent)

	resp, err := a.waClient.SendMessage(a.ctx, parsedJID, msgContent)
	if err != nil {
		log.Println("SendMessage error:", err)
		return "", err
	}

	// Manually add to store and emit event so UI updates immediately
	msgEvent := &events.Message{
		Info: types.MessageInfo{
			ID:        resp.ID,
			Timestamp: resp.Timestamp,
			MessageSource: types.MessageSource{
				Chat:     parsedJID,
				IsFromMe: true,
				Sender:   *a.waClient.Store.ID,
			},
		},
		Message: msgContent,
	}
	parsedHTML := a.processMessageText(msgContent)
	messageID := a.messageStore.ProcessMessageEvent(a.ctx, a.waClient.Store.LIDs, msgEvent, parsedHTML)

	// Extract message text for chat list update
	var messageText string
	if msgContent.GetConversation() != "" {
		messageText = msgContent.GetConversation()
	} else if msgContent.GetExtendedTextMessage() != nil {
		messageText = msgContent.GetExtendedTextMessage().GetText()
	} else {
		switch {
		case msgContent.GetImageMessage() != nil:
			messageText = "image"
		case msgContent.GetVideoMessage() != nil:
			messageText = "video"
		case msgContent.GetAudioMessage() != nil:
			if msgContent.GetAudioMessage().GetPTT() {
				messageText = "voice message"
			} else {
				messageText = "audio"
			}
		case msgContent.GetDocumentMessage() != nil:
			messageText = "document"
		case msgContent.GetStickerMessage() != nil:
			messageText = "sticker"
		default:
			messageText = "message"
		}
	}

	var msg any
	if messageID != "" {
		decodedMsg, err := a.messageStore.GetDecodedMessage(parsedJID.String(), messageID)
		if err == nil {
			msg = decodedMsg
		}
	}

	if msg == nil {
		msg = struct {
			Info    types.MessageInfo
			Content *waE2E.Message
		}{
			Info:    msgEvent.Info,
			Content: msgEvent.Message,
		}
	}

	runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
		"chatId":       parsedJID.String(),
		"message":      msg,
		"clientTempId": content.ClientTempID,
		"messageText":  messageText,
		"parsedHTML":   parsedHTML,
		"timestamp":    resp.Timestamp.Unix(),
		"sender":       "You",
	})

	return resp.ID, nil
}

// ForwardMessage forwards an existing message to one or more target chats.
func (a *Api) ForwardMessage(messageID string, targetChatJIDs []string) error {
	if a.waClient == nil || a.waClient.Store == nil || a.waClient.Store.ID == nil {
		return fmt.Errorf("client not logged in")
	}
	if a.messageStore == nil {
		return fmt.Errorf("message store is not ready")
	}
	if len(targetChatJIDs) == 0 {
		return fmt.Errorf("no target chats specified")
	}

	msg, err := a.messageStore.GetMessageWithMediaByID(messageID)
	if err != nil || msg == nil {
		return fmt.Errorf("message not found: %w", err)
	}

	forwardedMsg := buildForwardedMessage(msg)
	if forwardedMsg == nil {
		return fmt.Errorf("failed to build forwarded message")
	}

	var sentCount int
	var lastErr error
	for _, targetJIDStr := range targetChatJIDs {
		targetJID, err := types.ParseJID(targetJIDStr)
		if err != nil {
			lastErr = fmt.Errorf("invalid JID %s: %w", targetJIDStr, err)
			continue
		}

		resp, err := a.waClient.SendMessage(a.ctx, targetJID, forwardedMsg)
		if err != nil {
			log.Printf("Failed to forward message to %s: %v", targetJIDStr, err)
			lastErr = err
			continue
		}

		sentCount++

		// Manually add to store and emit event so UI updates immediately
		msgEvent := &events.Message{
			Info: types.MessageInfo{
				ID:        resp.ID,
				Timestamp: resp.Timestamp,
				MessageSource: types.MessageSource{
					Chat:     targetJID,
					IsFromMe: true,
					Sender:   *a.waClient.Store.ID,
				},
			},
			Message: forwardedMsg,
		}
		parsedHTML := a.processMessageText(forwardedMsg)
		newMsgID := a.messageStore.ProcessMessageEvent(a.ctx, a.waClient.Store.LIDs, msgEvent, parsedHTML)

		var sentDecodedMsg any
		if newMsgID != "" {
			if decoded, err := a.messageStore.GetDecodedMessage(targetJID.String(), newMsgID); err == nil {
				sentDecodedMsg = decoded
			}
		}

		a.emit("wa:new_message", map[string]any{
			"chatId":  targetJID.String(),
			"message": sentDecodedMsg,
		})
	}

	if sentCount == 0 && lastErr != nil {
		return lastErr
	}
	return nil
}

func (a *Api) MarkRead(chatJID string, messageIDs []string, Type string) error {
	parsedChatJID, err := types.ParseJID(chatJID)
	if err != nil {
		return err
	}
	if Type == "read-msg" {
		for _, msgID := range messageIDs {
			msg, err := a.messageStore.GetMessageWithMedia(chatJID, msgID)
			if err != nil {
				log.Printf("Failed to get message %s: %v", msgID, err)
				continue
			}
			senderJID := msg.Info.Sender
			ids := []types.MessageID{types.MessageID(msgID)}
			err = a.waClient.MarkRead(a.ctx, ids, time.Now(), parsedChatJID, senderJID)
			if err != nil {
				log.Printf("MarkRead error for message %s: %v", msgID, err)
			}
		}
	}
	return nil
}

// EditMessage edits a previously sent text message.
func (a *Api) EditMessage(chatJID string, messageID string, newText string) error {
	if a.waClient == nil || a.waClient.Store == nil || a.waClient.Store.ID == nil {
		return fmt.Errorf("client not logged in")
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return err
	}

	if a.messageStore != nil {
		msg, err := a.messageStore.GetMessageWithMediaByID(messageID)
		if err == nil && msg != nil {
			if !msg.Info.IsFromMe {
				return fmt.Errorf("cannot edit messages from other senders")
			}
			if msg.IsDeleted {
				return fmt.Errorf("cannot edit deleted messages")
			}
			if msg.Media != nil {
				return fmt.Errorf("cannot edit media messages")
			}
			if time.Since(msg.Info.Timestamp) > 15*time.Minute {
				return fmt.Errorf("message is too old to edit (WhatsApp edit window is 15 minutes)")
			}
		}
	}

	newContent := &waE2E.Message{
		Conversation: proto.String(newText),
	}
	editMsg := a.waClient.BuildEdit(chat, types.MessageID(messageID), newContent)

	_, err = a.waClient.SendMessage(a.ctx, chat, editMsg)
	if err != nil {
		return fmt.Errorf("failed to send edit: %w", err)
	}

	// Update local store immediately
	parsedHTML := a.processMessageText(newContent)
	if a.messageStore != nil {
		_ = a.messageStore.UpdateMessageContent(nil, messageID, newContent, parsedHTML, time.Now().Unix())
		if updatedMsg, err := a.messageStore.GetDecodedMessage(chatJID, messageID); err == nil {
			runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
				"chatId":      chatJID,
				"message":     updatedMsg,
				"messageText": parsedHTML,
			})
		}
	}

	return nil
}

// DeleteMessage revokes a message for everyone or deletes it locally for the current user.
func (a *Api) DeleteMessage(chatJID string, messageID string, forEveryone bool) error {
	if a.waClient == nil || a.waClient.Store == nil || a.waClient.Store.ID == nil {
		return fmt.Errorf("client not logged in")
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return err
	}

	if forEveryone {
		revokeMsg := a.waClient.BuildRevoke(chat, types.EmptyJID, types.MessageID(messageID))
		_, err = a.waClient.SendMessage(a.ctx, chat, revokeMsg)
		if err != nil {
			return fmt.Errorf("failed to revoke message: %w", err)
		}
		if a.messageStore != nil {
			_ = a.messageStore.MarkMessageDeleted(messageID)
			if updatedMsg, err := a.messageStore.GetDecodedMessage(chatJID, messageID); err == nil {
				runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
					"chatId":  chatJID,
					"message": updatedMsg,
				})
			}
		}
	} else {
		if a.messageStore != nil {
			_ = a.messageStore.DeleteMessageLocally(messageID)
			runtime.EventsEmit(a.ctx, "wa:message_deleted", map[string]any{
				"chatId":    chatJID,
				"messageId": messageID,
			})
		}
	}

	return nil
}

// ---- Message pins ----

// PinExpirySeconds mirrors WhatsApp's default pin duration (7 days).
const PinExpirySeconds = 7 * 24 * 60 * 60

func (a *Api) GetPinnedMessages(chatJID string) ([]store.PinnedMessage, error) {
	return a.messageStore.GetPinnedMessages(chatJID)
}

// SetMessagePinned pins or unpins a message for everyone in the chat and
// records the change locally.
func (a *Api) SetMessagePinned(chatJID, senderJID, messageID string, fromMe, pin bool) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return err
	}

	key := &waCommon.MessageKey{
		RemoteJID: proto.String(chatJID),
		FromMe:    proto.Bool(fromMe),
		ID:        proto.String(messageID),
	}
	if chat.Server == types.GroupServer && !fromMe && senderJID != "" {
		key.Participant = proto.String(senderJID)
	}

	pinType := waE2E.PinInChatMessage_PIN_FOR_ALL
	if !pin {
		pinType = waE2E.PinInChatMessage_UNPIN_FOR_ALL
	}
	msg := &waE2E.Message{
		PinInChatMessage: &waE2E.PinInChatMessage{
			Key:               key,
			Type:              &pinType,
			SenderTimestampMS: proto.Int64(time.Now().UnixMilli()),
		},
		MessageContextInfo: &waE2E.MessageContextInfo{
			MessageAddOnDurationInSecs: proto.Uint32(uint32(PinExpirySeconds)),
		},
	}
	if _, err := a.waClient.SendMessage(a.ctx, chat, msg); err != nil {
		return err
	}

	sender := a.waClient.Store.ID.String()
	if err := a.messageStore.ApplyMessagePin(chatJID, sender, messageID, pin, PinExpirySeconds); err != nil {
		log.Println("SetMessagePinned: failed to persist:", err)
	}
	runtime.EventsEmit(a.ctx, "wa:pinned_update", map[string]any{"chatId": chatJID})
	return nil
}

// sendAndStoreLocal sends a prebuilt message and records it locally so the
// UI shows it immediately, mirroring SendMessage's echo path.
func (a *Api) sendAndStoreLocal(chat types.JID, msgContent *waE2E.Message, preview string) (string, error) {
	resp, err := a.waClient.SendMessage(a.ctx, chat, msgContent)
	if err != nil {
		return "", err
	}
	msgEvent := &events.Message{
		Info: types.MessageInfo{
			ID:        resp.ID,
			Timestamp: resp.Timestamp,
			MessageSource: types.MessageSource{
				Chat:     chat,
				IsFromMe: true,
				Sender:   *a.waClient.Store.ID,
			},
		},
		Message: msgContent,
	}
	messageID := a.messageStore.ProcessMessageEvent(a.ctx, a.waClient.Store.LIDs, msgEvent, "")

	var msg any
	if messageID != "" {
		if decodedMsg, derr := a.messageStore.GetDecodedMessage(chat.String(), messageID); derr == nil {
			msg = decodedMsg
		}
	}
	runtime.EventsEmit(a.ctx, "wa:new_message", map[string]any{
		"chatId":      chat.String(),
		"message":     msg,
		"messageText": preview,
		"timestamp":   resp.Timestamp.Unix(),
		"sender":      "You",
		"isFromMe":    true,
	})
	return resp.ID, nil
}

// SendPoll creates a poll in the chat. selectableCount 1 = single answer,
// 0 or len(options) = multiple answers allowed.
func (a *Api) SendPoll(chatJID, name string, options []string, selectableCount int) (string, error) {
	if a.waClient.Store.ID == nil {
		return "", fmt.Errorf("client not logged in")
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return "", err
	}
	name = strings.TrimSpace(name)
	clean := make([]string, 0, len(options))
	for _, o := range options {
		if o = strings.TrimSpace(o); o != "" {
			clean = append(clean, o)
		}
	}
	if name == "" || len(clean) < 2 {
		return "", fmt.Errorf("a poll needs a question and at least two options")
	}
	msg := a.waClient.BuildPollCreation(name, clean, selectableCount)
	return a.sendAndStoreLocal(chat, msg, "📊 "+name)
}

// SendShareContact shares a contact card in the chat.
func (a *Api) SendShareContact(chatJID, displayName, phone string) (string, error) {
	if a.waClient.Store.ID == nil {
		return "", fmt.Errorf("client not logged in")
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return "", err
	}
	displayName = strings.TrimSpace(displayName)
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, phone)
	if displayName == "" || digits == "" {
		return "", fmt.Errorf("contact needs a name and a phone number")
	}
	vcard := fmt.Sprintf(
		"BEGIN:VCARD\nVERSION:3.0\nFN:%s\nTEL;type=CELL;waid=%s:+%s\nEND:VCARD",
		displayName, digits, digits)
	msg := &waE2E.Message{
		ContactMessage: &waE2E.ContactMessage{
			DisplayName: &displayName,
			Vcard:       &vcard,
		},
	}
	return a.sendAndStoreLocal(chat, msg, "👤 "+displayName)
}

