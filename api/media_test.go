package api

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lugvitc/whats4linux/internal/cache"
	"github.com/lugvitc/whats4linux/internal/misc"
	messageStore "github.com/lugvitc/whats4linux/internal/store"
	"github.com/polymorfa/hypermeow/proto/waE2E"
	"github.com/polymorfa/hypermeow/types"
	"google.golang.org/protobuf/proto"
)

func newMediaTestAPI(t *testing.T) *Api {
	t.Helper()
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
		ID:        "text-only",
		Timestamp: time.Now(),
		MessageSource: types.MessageSource{
			Chat: chat, Sender: sender,
		},
	}
	if err := store.InsertMessage(
		&info,
		&waE2E.Message{Conversation: proto.String("hello")},
		"hello",
	); err != nil {
		t.Fatal(err)
	}

	return &Api{
		ctx:          context.Background(),
		messageStore: store,
		imageCache:   imageCache,
	}
}

func TestMediaMethodsRejectMessagesWithoutMedia(t *testing.T) {
	a := newMediaTestAPI(t)

	if _, err := a.GetCachedImage("text-only"); err == nil || !strings.Contains(err.Error(), "no downloadable image") {
		t.Fatalf("GetCachedImage error = %v, want no downloadable image", err)
	}
	if _, err := a.DownloadMedia("123@s.whatsapp.net", "text-only"); err == nil || !strings.Contains(err.Error(), "no downloadable media") {
		t.Fatalf("DownloadMedia error = %v, want no downloadable media", err)
	}
	if _, _, _, _, err := a.downloadMedia(nil); err == nil {
		t.Fatal("downloadMedia(nil) returned no error")
	}
}

func TestMediaMethodsHandleUninitialisedAPI(t *testing.T) {
	a := &Api{}

	if a.GetLinkPreview("message") != nil {
		t.Fatal("GetLinkPreview returned a preview without a message store")
	}
	if a.GetLinkPreviewImage("message") != "" {
		t.Fatal("GetLinkPreviewImage returned data without a message store")
	}
	if a.GetVideoThumbnail("message") != "" {
		t.Fatal("GetVideoThumbnail returned data without a message store")
	}
	if _, err := a.DownloadMedia("chat", "message"); err == nil {
		t.Fatal("DownloadMedia returned no error without a message store")
	}
	if _, err := a.GetCachedImage("message"); err == nil {
		t.Fatal("GetCachedImage returned no error without an image cache")
	}
	if _, err := a.GetCachedAvatar("123@s.whatsapp.net", false); err == nil {
		t.Fatal("GetCachedAvatar returned no error without an image cache")
	}
	if err := a.DownloadFile("message"); err == nil {
		t.Fatal("DownloadFile returned no error without a message store")
	}
	if err := a.DownloadImageToFile("message"); err == nil {
		t.Fatal("DownloadImageToFile returned no error without a message store")
	}
}

func TestDownloadFileSavesCachedImage(t *testing.T) {
	a := newMediaTestAPI(t)
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	testData := []byte("fake-image-bytes")
	msgID := "img-msg-123"
	if _, err := a.imageCache.SaveImage(msgID, testData, "image/png", 100, 100); err != nil {
		t.Fatalf("failed to save image to cache: %v", err)
	}

	if err := a.DownloadFile(msgID); err != nil {
		t.Fatalf("DownloadFile failed: %v", err)
	}

	expectedPath := filepath.Join(tempHome, "Downloads", "Whats4L", msgID+".png")
	savedData, err := os.ReadFile(expectedPath)
	if err != nil {
		t.Fatalf("expected file to be written at %s: %v", expectedPath, err)
	}
	if string(savedData) != string(testData) {
		t.Fatalf("file content mismatch: got %s, want %s", string(savedData), string(testData))
	}
}

func TestDownloadDirectoryConfigurable(t *testing.T) {
	a := newMediaTestAPI(t)
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	// Default should be ~/Downloads/Whats4L
	def := a.GetDownloadDirectory()
	expectedDef := filepath.Join(tempHome, "Downloads", "Whats4L")
	if def != expectedDef {
		t.Fatalf("GetDownloadDirectory default = %q, want %q", def, expectedDef)
	}

	// Custom directory
	custom := filepath.Join(tempHome, "CustomDownloads")
	if err := a.SetDownloadDirectory(custom); err != nil {
		t.Fatalf("SetDownloadDirectory failed: %v", err)
	}
	if got := a.GetDownloadDirectory(); got != custom {
		t.Fatalf("GetDownloadDirectory custom = %q, want %q", got, custom)
	}

	// Tilde expansion
	if err := a.SetDownloadDirectory("~/MyTildeDir"); err != nil {
		t.Fatalf("SetDownloadDirectory tilde failed: %v", err)
	}
	expectedTilde := filepath.Join(tempHome, "MyTildeDir")
	if got := a.GetDownloadDirectory(); got != expectedTilde {
		t.Fatalf("GetDownloadDirectory tilde = %q, want %q", got, expectedTilde)
	}
}

func TestGetCachedAvatarCanonicalDeviceJID(t *testing.T) {
	a := newMediaTestAPI(t)
	dummyData := []byte("fake-jpeg-data")
	if _, err := a.imageCache.SaveAvatar("123@s.whatsapp.net", dummyData, "image/jpeg"); err != nil {
		t.Fatal(err)
	}

	// Should resolve even when querying with a device suffix
	avatarURL, err := a.GetCachedAvatar("123:2@s.whatsapp.net", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(avatarURL, "data:image/jpeg;base64,") {
		t.Fatalf("expected data URL, got %q", avatarURL)
	}
}
