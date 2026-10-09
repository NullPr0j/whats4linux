package api

import (
	"context"
	"testing"
	"time"

	"github.com/lugvitc/whats4linux/internal/cache"
	"github.com/lugvitc/whats4linux/internal/misc"
	messageStore "github.com/lugvitc/whats4linux/internal/store"
	mtypes "github.com/lugvitc/whats4linux/internal/types"
	"github.com/lugvitc/whats4linux/internal/wa"
	"github.com/polymorfa/hypermeow/proto/waE2E"
	"github.com/polymorfa/hypermeow/types"
	"google.golang.org/protobuf/proto"
)

func TestBuildForwardedMessageText(t *testing.T) {
	msg := &messageStore.ExtendedMessage{
		Text: "Hello world forwarded",
	}

	forwarded := buildForwardedMessage(msg)
	if forwarded == nil {
		t.Fatal("expected non-nil forwarded message")
	}
	if forwarded.ExtendedTextMessage == nil {
		t.Fatal("expected ExtendedTextMessage for forwarded text")
	}
	if forwarded.ExtendedTextMessage.GetText() != "Hello world forwarded" {
		t.Fatalf("unexpected text: %s", forwarded.ExtendedTextMessage.GetText())
	}
	ctxInfo := forwarded.ExtendedTextMessage.GetContextInfo()
	if ctxInfo == nil || !ctxInfo.GetIsForwarded() {
		t.Fatal("expected contextInfo with IsForwarded: true")
	}
	if ctxInfo.GetForwardingScore() != 1 {
		t.Fatalf("expected forwarding score 1, got %d", ctxInfo.GetForwardingScore())
	}
}

func TestBuildForwardedMessageTextWithHTMLTags(t *testing.T) {
	msg := &messageStore.ExtendedMessage{
		Text: "<p>Hello world forwarded</p>",
	}

	forwarded := buildForwardedMessage(msg)
	if forwarded == nil {
		t.Fatal("expected non-nil forwarded message")
	}
	if forwarded.ExtendedTextMessage == nil {
		t.Fatal("expected ExtendedTextMessage for forwarded text")
	}
	if forwarded.ExtendedTextMessage.GetText() != "Hello world forwarded" {
		t.Fatalf("expected plain text without <p> tags, got: %q", forwarded.ExtendedTextMessage.GetText())
	}
}

func TestBuildForwardedMessageMedia(t *testing.T) {
	media := wa.NewMedia(
		"/direct/path",
		[]byte("mediakey"),
		[]byte("sha256"),
		[]byte("encsha256"),
		"https://example.com/image.jpg",
		"image/jpeg",
		800, 600,
		mtypes.MediaTypeImage,
		"photo.jpg",
	)

	msg := &messageStore.ExtendedMessage{
		Text:  "Caption here",
		Media: media,
	}

	forwarded := buildForwardedMessage(msg)
	if forwarded == nil {
		t.Fatal("expected non-nil forwarded message")
	}
	if forwarded.ImageMessage == nil {
		t.Fatal("expected ImageMessage")
	}
	if forwarded.ImageMessage.GetCaption() != "Caption here" {
		t.Fatalf("unexpected caption: %s", forwarded.ImageMessage.GetCaption())
	}
	if string(forwarded.ImageMessage.GetMediaKey()) != "mediakey" {
		t.Fatal("expected mediakey to be preserved")
	}
	ctxInfo := forwarded.ImageMessage.GetContextInfo()
	if ctxInfo == nil || !ctxInfo.GetIsForwarded() {
		t.Fatal("expected contextInfo with IsForwarded: true")
	}
}

func TestForwardMessageNotLoggedIn(t *testing.T) {
	oldConfigDir := misc.ConfigDir
	misc.ConfigDir = t.TempDir()
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Cleanup(func() { misc.ConfigDir = oldConfigDir })

	messageStore.LoadSettings()
	t.Cleanup(func() { _ = messageStore.CloseSettings() })

	store, err := messageStore.NewMessageStore()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	imageCache, err := cache.NewImageCache()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = imageCache.Close() })

	chat, _ := types.ParseJID("123@s.whatsapp.net")
	sender, _ := types.ParseJID("456@s.whatsapp.net")
	info := types.MessageInfo{
		ID:        "msg-forward-1",
		Timestamp: time.Now(),
		MessageSource: types.MessageSource{
			Chat: chat, Sender: sender,
		},
	}
	if err := store.InsertMessage(
		&info,
		&waE2E.Message{Conversation: proto.String("original")},
		"original",
	); err != nil {
		t.Fatal(err)
	}

	api := &Api{
		ctx:          context.Background(),
		messageStore: store,
		imageCache:   imageCache,
	}

	// waClient is nil -> should error gracefully
	err = api.ForwardMessage("msg-forward-1", []string{"789@s.whatsapp.net"})
	if err == nil {
		t.Fatal("expected error when client not logged in")
	}
}
