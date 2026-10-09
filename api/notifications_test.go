package api

import (
	"testing"

	"go.mau.fi/whatsmeow/types"
)

func TestSetActiveChatAndIsSameChat(t *testing.T) {
	a := New()
	if a.isSameChat(a.activeChatId, types.NewJID("123456789", types.DefaultUserServer)) {
		t.Fatalf("expected isSameChat to be false when activeChatId is empty")
	}

	jid1 := types.NewJID("123456789", types.DefaultUserServer)
	jid2 := types.NewJID("987654321", types.DefaultUserServer)

	a.SetActiveChat(jid1.String())
	if !a.isSameChat(a.activeChatId, jid1) {
		t.Fatalf("expected isSameChat to be true for jid1")
	}
	if a.isSameChat(a.activeChatId, jid2) {
		t.Fatalf("expected isSameChat to be false for jid2 when jid1 is active")
	}

	a.SetActiveChat("")
	if a.isSameChat(a.activeChatId, jid1) {
		t.Fatalf("expected isSameChat to be false after resetting active chat")
	}
}

func TestResolveSenderName(t *testing.T) {
	a := New()
	sender := types.NewJID("1234567890", types.DefaultUserServer)

	// PushName takes precedence
	if name := a.resolveSenderName(sender, "Alice"); name != "Alice" {
		t.Fatalf("expected 'Alice', got %q", name)
	}

	// Falls back to phone number with +
	if name := a.resolveSenderName(sender, ""); name != "+1234567890" {
		t.Fatalf("expected '+1234567890', got %q", name)
	}

	// Empty sender falls back to 'Someone'
	if name := a.resolveSenderName(types.EmptyJID, ""); name != "Someone" {
		t.Fatalf("expected 'Someone', got %q", name)
	}
}
