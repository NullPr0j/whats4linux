package api

import (
	"context"
	"strings"

	"github.com/nyaruka/phonenumbers"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/types"
)

type Contact struct {
	Phno       string `json:"phno"`
	JID        string `json:"jid"`
	Short      string `json:"short"`
	FullName   string `json:"full_name"`
	PushName   string `json:"push_name"`
	IsBusiness bool   `json:"is_business"`
	AvatarURL  string `json:"avatar_url"`
}

func canonicalUserJID(ctx context.Context, client *whatsmeow.Client, jid types.JID) types.JID {
	if jid.ActualAgent() == types.LIDDomain || jid.Server == "lid" {
		if client != nil && client.Store != nil && client.Store.LIDs != nil {
			if pn, err := client.Store.LIDs.GetPNForLID(ctx, jid); err == nil && pn.User != "" {
				jid = pn
			}
		}
	}
	return jid.ToNonAD()
}

func (a *Api) GetContact(jid types.JID) (*Contact, error) {
	jid = canonicalUserJID(a.ctx, a.waClient, jid)
	contact, err := a.waClient.Store.Contacts.GetContact(a.ctx, jid)
	if err != nil {
		return nil, err
	}
	var formattedPhone string
	if jid.Server == types.DefaultUserServer || jid.Server == "s.whatsapp.net" {
		rawNum := "+" + jid.User
		num, err := phonenumbers.Parse(rawNum, "")
		if err == nil && phonenumbers.IsValidNumber(num) {
			formattedPhone = phonenumbers.Format(num, phonenumbers.INTERNATIONAL)
		} else {
			formattedPhone = rawNum
		}
	}

	return &Contact{
		Phno:       formattedPhone,
		JID:        jid.String(),
		FullName:   contact.FullName,
		Short:      contact.FirstName,
		PushName:   contact.PushName,
		IsBusiness: contact.BusinessName != "",
	}, nil
}

func (a *Api) FetchContacts() ([]Contact, error) {
	rawContacts, err := a.waClient.Store.Contacts.GetAllContacts(a.ctx)
	if err != nil {
		return nil, err
	}

	selfUser := ""
	if a.waClient != nil && a.waClient.Store != nil && a.waClient.Store.ID != nil {
		selfUser = a.waClient.Store.ID.User
	}

	seen := make(map[string]bool)
	contacts := make([]Contact, 0, len(rawContacts))

	for jid, c := range rawContacts {
		// Only consider actual saved contacts from the phone's address book.
		// WhatsApp protocol sets FullName or FirstName only for address book contacts.
		// Unsaved group participants and random numbers have both empty.
		savedName := strings.TrimSpace(c.FullName)
		if savedName == "" {
			savedName = strings.TrimSpace(c.FirstName)
		}
		if savedName == "" {
			continue
		}

		// Canonicalize LID to PN if possible, or skip LID.
		targetJID := jid
		if targetJID.ActualAgent() == types.LIDDomain || targetJID.Server == "lid" {
			if a.waClient != nil && a.waClient.Store != nil && a.waClient.Store.LIDs != nil {
				if pn, err := a.waClient.Store.LIDs.GetPNForLID(a.ctx, targetJID); err == nil && pn.User != "" {
					targetJID = pn
				} else {
					continue
				}
			} else {
				continue
			}
		}

		// Ensure it's a standard user chat server (@s.whatsapp.net), not a group or unresolved LID
		if targetJID.Server != types.DefaultUserServer && targetJID.Server != "s.whatsapp.net" {
			continue
		}

		userPhone := targetJID.User
		if userPhone == "" || seen[userPhone] {
			continue
		}
		seen[userPhone] = true

		// Skip self
		if selfUser != "" && userPhone == selfUser {
			continue
		}

		rawNum := "+" + userPhone
		formattedPhone := rawNum
		num, err := phonenumbers.Parse(rawNum, "")
		if err == nil && phonenumbers.IsValidNumber(num) {
			formattedPhone = phonenumbers.Format(num, phonenumbers.INTERNATIONAL)
		}

		contacts = append(contacts, Contact{
			Phno:       formattedPhone,
			JID:        targetJID.ToNonAD().String(),
			FullName:   c.FullName,
			Short:      c.FirstName,
			PushName:   c.PushName,
			IsBusiness: c.BusinessName != "",
		})
	}
	return contacts, nil
}
