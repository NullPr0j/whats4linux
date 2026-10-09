package api

import (
	"errors"
	"fmt"

	"github.com/lugvitc/whats4linux/internal/wa"
	"github.com/polymorfa/hypermeow/types"
)

// StartCall initiates an outbound audio call to the given chatId (JID).
func (a *Api) StartCall(chatId string) (*wa.CallSession, error) {
	if a.callManager == nil {
		return nil, errors.New("call manager not initialized")
	}

	peerName := chatId
	if parsedJID, err := types.ParseJID(chatId); err == nil && a.waClient != nil && a.waClient.Store != nil {
		if c, err := a.waClient.Store.Contacts.GetContact(a.ctx, parsedJID); err == nil && c.FullName != "" {
			peerName = c.FullName
		}
	}

	session, err := a.callManager.StartCall(a.ctx, chatId, peerName)
	if err != nil {
		return nil, fmt.Errorf("start call error: %w", err)
	}
	return session, nil
}

// AcceptCall answers an incoming WhatsApp audio call.
func (a *Api) AcceptCall() error {
	if a.callManager == nil {
		return errors.New("call manager not initialized")
	}
	return a.callManager.AcceptCall()
}

// RejectCall declines an incoming WhatsApp audio call.
func (a *Api) RejectCall() error {
	if a.callManager == nil {
		return errors.New("call manager not initialized")
	}
	return a.callManager.RejectCall()
}

// EndCall terminates the ongoing or dialing WhatsApp call.
func (a *Api) EndCall() error {
	if a.callManager == nil {
		return errors.New("call manager not initialized")
	}
	return a.callManager.EndCall()
}

// ToggleCallMute toggles microphone mute state during an active call.
func (a *Api) ToggleCallMute() (bool, error) {
	if a.callManager == nil {
		return false, errors.New("call manager not initialized")
	}
	return a.callManager.ToggleMute()
}

// GetCallStatus returns the current active or incoming call state.
func (a *Api) GetCallStatus() *wa.CallSession {
	if a.callManager == nil {
		return &wa.CallSession{State: wa.CallStateIdle}
	}
	return a.callManager.GetSession()
}
