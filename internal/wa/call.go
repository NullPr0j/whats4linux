package wa

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/nyaruka/phonenumbers"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/types"
	"github.com/purpshell/meowcaller"
)

type CallState string

const (
	CallStateIdle       CallState = "idle"
	CallStateRingingIn  CallState = "ringing_in"
	CallStateRingingOut CallState = "ringing_out"
	CallStateConnected  CallState = "connected"
)

type CallSession struct {
	CallID    string    `json:"callId"`
	PeerJID   string    `json:"peerJid"`
	PeerName  string    `json:"peerName"`
	State     CallState `json:"state"`
	IsMuted   bool      `json:"isMuted"`
	StartedAt int64     `json:"startedAt,omitempty"`
}

type CallEventCallback func(event string, data any)

type CallManager struct {
	waClient   *whatsmeow.Client
	caller     *meowcaller.Client
	activeCall *meowcaller.Call
	session    *CallSession
	audio      *AudioPipeline
	ringtone   *RingtonePlayer
	onEvent    CallEventCallback
	mu         sync.Mutex
}

func NewCallManager(wa *whatsmeow.Client, onEvent CallEventCallback, isIncomingSoundsEnabled, isOutgoingSoundsEnabled func() bool) *CallManager {
	cm := &CallManager{
		waClient: wa,
		caller:   meowcaller.NewClient(wa),
		audio:    NewAudioPipeline(),
		ringtone: NewRingtonePlayer(isIncomingSoundsEnabled, isOutgoingSoundsEnabled),
		onEvent:  onEvent,
	}

	cm.caller.OnIncomingCall(cm.handleIncomingCall)
	return cm
}

func (cm *CallManager) emit(event string, data any) {
	if cm.onEvent != nil {
		cm.onEvent(event, data)
	}
}

func (cm *CallManager) GetSession() *CallSession {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if cm.session == nil {
		return &CallSession{
			State: CallStateIdle,
		}
	}
	cp := *cm.session
	return &cp
}

func (cm *CallManager) resolvePeerName(peer types.JID) (resolvedJID types.JID, name string) {
	resolvedJID = peer
	if cm.waClient != nil && cm.waClient.Store != nil {
		if peer.ActualAgent() == types.LIDDomain && cm.waClient.Store.LIDs != nil {
			if pn, err := cm.waClient.Store.LIDs.GetPNForLID(context.Background(), peer); err == nil && !pn.IsEmpty() {
				resolvedJID = pn
			}
		}
		resolvedJID = resolvedJID.ToNonAD()

		if cm.waClient.Store.Contacts != nil {
			// 1. Try finding contact by resolved phone-number JID
			if contact, err := cm.waClient.Store.Contacts.GetContact(context.Background(), resolvedJID); err == nil {
				if contact.FullName != "" {
					name = contact.FullName
				} else if contact.FirstName != "" {
					name = contact.FirstName
				} else if contact.PushName != "" {
					name = contact.PushName
				} else if contact.BusinessName != "" {
					name = contact.BusinessName
				}
			}

			// 2. If not found, try original peer JID
			if name == "" && peer.String() != resolvedJID.String() {
				if contact, err := cm.waClient.Store.Contacts.GetContact(context.Background(), peer.ToNonAD()); err == nil {
					if contact.FullName != "" {
						name = contact.FullName
					} else if contact.FirstName != "" {
						name = contact.FirstName
					} else if contact.PushName != "" {
						name = contact.PushName
					} else if contact.BusinessName != "" {
						name = contact.BusinessName
					}
				}
			}
		}
	}

	// 3. Fallback: formatted phone number
	if name == "" && resolvedJID.User != "" && resolvedJID.Server != types.HiddenUserServer {
		rawNum := "+" + resolvedJID.User
		if num, err := phonenumbers.Parse(rawNum, ""); err == nil {
			name = phonenumbers.Format(num, phonenumbers.INTERNATIONAL)
		} else {
			name = rawNum
		}
	}

	if name == "" {
		if resolvedJID.User != "" {
			name = resolvedJID.User
		} else {
			name = "WhatsApp Contact"
		}
	}

	return resolvedJID, name
}

func (cm *CallManager) handleIncomingCall(call *meowcaller.Call) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	// If already in a call, reject incoming call as busy
	if cm.session != nil && cm.session.State != CallStateIdle {
		_ = call.Reject()
		return
	}

	resolvedJID, peerName := cm.resolvePeerName(call.Peer())
	peerJID := resolvedJID.String()
	cm.activeCall = call
	cm.session = &CallSession{
		CallID:   call.ID(),
		PeerJID:  peerJID,
		PeerName: peerName,
		State:    CallStateRingingIn,
		IsMuted:  false,
	}

	cm.setupCallHooksLocked(call)

	if cm.ringtone != nil {
		cm.ringtone.StartRingtone()
	}

	cm.emit("wa:call_incoming", map[string]any{
		"callId":   call.ID(),
		"peerJid":  peerJID,
		"peerName": cm.session.PeerName,
	})
}

func (cm *CallManager) setupCallHooksLocked(call *meowcaller.Call) {
	callID := call.ID()

	call.OnEnd(func(reason string) {
		go func() {
			cm.mu.Lock()
			defer cm.mu.Unlock()
			if cm.activeCall != nil && cm.activeCall.ID() == callID {
				cm.cleanupLocked(reason)
			}
		}()
	})

	call.OnReady(func() {
		go func() {
			cm.mu.Lock()
			defer cm.mu.Unlock()
			if cm.activeCall != nil && cm.activeCall.ID() == callID {
				cm.startAudioLocked()
			}
		}()
	})

	call.OnPeerAccept(func() {
		go func() {
			cm.mu.Lock()
			defer cm.mu.Unlock()
			if cm.activeCall != nil && cm.activeCall.ID() == callID {
				cm.startAudioLocked()
			}
		}()
	})
}

func (cm *CallManager) startAudioLocked() {
	if cm.session == nil || cm.session.State == CallStateConnected {
		return
	}

	if cm.ringtone != nil {
		cm.ringtone.Stop()
	}

	cm.session.State = CallStateConnected
	cm.session.StartedAt = time.Now().Unix()

	if cm.audio != nil {
		_ = cm.audio.Start()
		if cm.activeCall != nil {
			cm.activeCall.Play(cm.audio.Mic)
			cm.activeCall.Receive(cm.audio.Speaker)
		}
	}

	cm.emit("wa:call_connected", map[string]any{
		"callId":    cm.session.CallID,
		"startedAt": cm.session.StartedAt,
	})
}

func (cm *CallManager) StartCall(ctx context.Context, peerJIDStr, peerName string) (*CallSession, error) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if cm.session != nil && cm.session.State != CallStateIdle {
		return nil, errors.New("a call is already in progress")
	}

	parsedJID, err := types.ParseJID(peerJIDStr)
	if err != nil {
		return nil, fmt.Errorf("invalid peer JID: %w", err)
	}

	call, err := cm.caller.Call(ctx, parsedJID.String())
	if err != nil {
		return nil, fmt.Errorf("failed to initiate call: %w", err)
	}

	cm.activeCall = call
	cm.session = &CallSession{
		CallID:   call.ID(),
		PeerJID:  parsedJID.String(),
		PeerName: peerName,
		State:    CallStateRingingOut,
		IsMuted:  false,
	}

	cm.setupCallHooksLocked(call)

	if cm.ringtone != nil {
		cm.ringtone.StartRinging()
	}

	sessionCp := *cm.session
	return &sessionCp, nil
}

func (cm *CallManager) AcceptCall() error {
	cm.mu.Lock()
	if cm.activeCall == nil || cm.session == nil || cm.session.State != CallStateRingingIn {
		cm.mu.Unlock()
		return errors.New("no incoming call to accept")
	}

	call := cm.activeCall
	if cm.ringtone != nil {
		cm.ringtone.Stop()
	}
	cm.mu.Unlock()

	if err := call.Answer(); err != nil {
		return fmt.Errorf("failed to answer call: %w", err)
	}

	cm.mu.Lock()
	if cm.activeCall == call {
		cm.startAudioLocked()
	}
	cm.mu.Unlock()

	return nil
}

func (cm *CallManager) RejectCall() error {
	cm.mu.Lock()
	if cm.activeCall == nil || cm.session == nil || cm.session.State != CallStateRingingIn {
		cm.mu.Unlock()
		return errors.New("no incoming call to reject")
	}

	call := cm.activeCall
	cm.cleanupLocked("rejected")
	cm.mu.Unlock()

	return call.Reject()
}

func (cm *CallManager) EndCall() error {
	cm.mu.Lock()
	if cm.activeCall == nil || cm.session == nil || cm.session.State == CallStateIdle {
		cm.mu.Unlock()
		return errors.New("no active call to end")
	}

	call := cm.activeCall
	cm.cleanupLocked("hangup")
	cm.mu.Unlock()

	return call.Hangup()
}

func (cm *CallManager) ToggleMute() (bool, error) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if cm.session == nil || cm.session.State == CallStateIdle {
		return false, errors.New("no active call")
	}

	newMute := !cm.session.IsMuted
	cm.session.IsMuted = newMute

	if cm.audio != nil && cm.audio.Mic != nil {
		cm.audio.Mic.SetMute(newMute)
	}

	cm.emit("wa:call_muted", map[string]any{
		"callId":  cm.session.CallID,
		"isMuted": newMute,
	})

	return newMute, nil
}

func (cm *CallManager) cleanupLocked(reason string) {
	callID := ""
	if cm.session != nil {
		callID = cm.session.CallID
	}

	if cm.ringtone != nil {
		cm.ringtone.Stop()
	}

	if cm.audio != nil {
		cm.audio.Stop()
	}

	cm.activeCall = nil
	cm.session = &CallSession{
		State: CallStateIdle,
	}

	cm.emit("wa:call_ended", map[string]any{
		"callId": callID,
		"reason": reason,
	})
}
