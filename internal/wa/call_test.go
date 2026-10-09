package wa

import (
	"testing"
)

func TestCallManagerSessionTransitions(t *testing.T) {
	var lastEvent string
	var lastData any

	cm := &CallManager{
		onEvent: func(event string, data any) {
			lastEvent = event
			lastData = data
		},
	}

	// 1. Initial State
	session := cm.GetSession()
	if session.State != CallStateIdle {
		t.Errorf("expected initial state idle, got %s", session.State)
	}

	// 2. Simulate setting an incoming session
	cm.mu.Lock()
	cm.session = &CallSession{
		CallID:   "call-123",
		PeerJID:  "123456789@s.whatsapp.net",
		PeerName: "Alice",
		State:    CallStateRingingIn,
	}
	cm.mu.Unlock()

	s := cm.GetSession()
	if s.State != CallStateRingingIn {
		t.Errorf("expected state ringing_in, got %s", s.State)
	}
	if s.PeerName != "Alice" {
		t.Errorf("expected peer Alice, got %s", s.PeerName)
	}

	// 3. Mute toggle
	muted, err := cm.ToggleMute()
	if err != nil {
		t.Fatalf("unexpected error toggling mute: %v", err)
	}
	if !muted {
		t.Errorf("expected muted true, got false")
	}
	if lastEvent != "wa:call_muted" {
		t.Errorf("expected event wa:call_muted, got %s", lastEvent)
	}

	// 4. Reset
	cm.cleanupLocked("hangup")
	s2 := cm.GetSession()
	if s2.State != CallStateIdle {
		t.Errorf("expected state idle after cleanup, got %s", s2.State)
	}
	if lastEvent != "wa:call_ended" {
		t.Errorf("expected event wa:call_ended, got %s", lastEvent)
	}
	_ = lastData
}
