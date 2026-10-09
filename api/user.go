package api

import (
	"fmt"
	"strings"

	"github.com/nyaruka/phonenumbers"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

// GetMyJID returns the logged-in user's phone-number part, used to identify
// which reactions are our own (for toggling them off).
func (a *Api) GetMyJID() string {
	if a.waClient.Store.ID == nil {
		return ""
	}
	return a.waClient.Store.ID.User
}

func (a *Api) GetProfile(jidStr string) (Contact, error) {
	var targetJID types.JID
	if jidStr == "" {
		if a.waClient.Store.ID == nil {
			return Contact{}, fmt.Errorf("not logged in")
		}
		targetJID = *a.waClient.Store.ID
	} else {
		var err error
		targetJID, err = types.ParseJID(jidStr)
		if err != nil {
			return Contact{}, fmt.Errorf("invalid JID: %w", err)
		}
	}

	if a.waClient != nil {
		targetJID = canonicalUserJID(a.ctx, a.waClient, targetJID)
	} else {
		targetJID = targetJID.ToNonAD()
	}

	contact, _ := a.waClient.Store.Contacts.GetContact(a.ctx, targetJID)
	rawNum := "+" + targetJID.User

	jid := rawNum
	num, err := phonenumbers.Parse(rawNum, "")
	if err == nil && phonenumbers.IsValidNumber(num) {
		jid = phonenumbers.Format(num, phonenumbers.INTERNATIONAL)
	}

	var avatarURL string
	if a.imageCache != nil {
		if cached, err := a.GetCachedAvatar(targetJID.String(), false); err == nil && cached != "" {
			avatarURL = cached
		}
	}

	if avatarURL == "" {
		pic, _ := a.waClient.GetProfilePictureInfo(a.ctx, targetJID, &whatsmeow.GetProfilePictureParams{
			Preview: true,
		})
		if pic != nil {
			avatarURL = pic.URL
		}
	}

	if jidStr != "" && a.waClient != nil && a.waClient.Store != nil && a.waClient.Store.ID != nil && targetJID.User == a.waClient.Store.ID.User && !strings.Contains(targetJID.Server, "g.us") {
		return Contact{
			Phno:       jid,
			JID:        targetJID.String(),
			FullName:   "You",
			Short:      "You",
			PushName:   "Message yourself",
			IsBusiness: false,
			AvatarURL:  avatarURL,
		}, nil
	}

	pushName := contact.PushName
	// If it's self, try to get pushname from store if contact pushname is empty
	if jidStr == "" && a.waClient.Store.PushName != "" {
		pushName = a.waClient.Store.PushName
	}

	return Contact{
		Phno:       jid,
		JID:        targetJID.String(),
		FullName:   contact.FullName,
		Short:      contact.FirstName,
		PushName:   pushName,
		IsBusiness: contact.BusinessName != "",
		AvatarURL:  avatarURL,
	}, nil
}
