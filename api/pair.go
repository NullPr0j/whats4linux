package api

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nyaruka/phonenumbers"
	"github.com/polymorfa/hypermeow"
)

// SanitizePhoneNumber parses and validates an international phone number.
// It returns an E.164 formatted number without the leading '+' or zeros,
// which is the format strictly required by WhatsApp and whatsmeow.
func SanitizePhoneNumber(rawPhone string) (string, error) {
	trimmed := strings.TrimSpace(rawPhone)
	if trimmed == "" {
		return "", errors.New("phone number cannot be empty")
	}

	// Remove common spacing, hyphens, parentheses
	var cleanInput strings.Builder
	for _, ch := range trimmed {
		if (ch >= '0' && ch <= '9') || ch == '+' {
			cleanInput.WriteRune(ch)
		}
	}
	input := cleanInput.String()

	// If missing a leading '+', add it to parse as international number
	if !strings.HasPrefix(input, "+") {
		input = "+" + input
	}

	parsed, err := phonenumbers.Parse(input, "")
	if err != nil || !phonenumbers.IsValidNumber(parsed) {
		return "", fmt.Errorf("invalid international phone number: please include a valid country code (e.g., +1 for US/Canada)")
	}

	formatted := phonenumbers.Format(parsed, phonenumbers.E164)
	digits := strings.TrimPrefix(formatted, "+")

	if len(digits) <= 6 {
		return "", errors.New("phone number is too short")
	}
	if strings.HasPrefix(digits, "0") {
		return "", errors.New("phone number cannot start with zero in international format")
	}

	return digits, nil
}

// PairPhone initiates the WhatsApp phone number pairing flow.
// It validates the phone number, verifies that the client is connected,
// and requests an 8-character pairing code from WhatsApp's servers.
func (a *Api) PairPhone(phoneNumber string) (string, error) {
	if a.isShuttingDown() {
		return "", context.Canceled
	}

	cleanPhone, err := SanitizePhoneNumber(phoneNumber)
	if err != nil {
		return "", err
	}

	a.lifecycleMu.Lock()
	if a.startupErr != nil {
		err := a.startupErr
		a.lifecycleMu.Unlock()
		return "", err
	}
	client := a.waClient
	a.lifecycleMu.Unlock()

	if client == nil {
		return "", errors.New("WhatsApp client is not ready")
	}

	if client.Store.ID != nil {
		return "", errors.New("already logged in to WhatsApp")
	}

	// Wait up to 10 seconds for the WhatsApp WebSocket to establish connection
	waitCtx, waitCancel := context.WithTimeout(a.ctx, 10*time.Second)
	defer waitCancel()

	for !client.IsConnected() {
		select {
		case <-waitCtx.Done():
			return "", errors.New("connection timeout: please ensure the network is active and try again")
		case <-time.After(100 * time.Millisecond):
		}
	}

	// Request 8-character pairing code from whatsmeow.
	// WhatsApp strictly requires clientDisplayName to be in "Browser (OS)" format.
	code, err := client.PairPhone(
		a.ctx,
		cleanPhone,
		true, // showPushNotification on primary phone
		whatsmeow.PairClientChrome,
		"Chrome (Linux)",
	)
	if err != nil {
		return "", fmt.Errorf("failed to generate pairing code: %w", err)
	}

	return code, nil
}
