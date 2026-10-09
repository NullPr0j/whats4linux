package api

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gen2brain/beeep"
	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/types"
)

// LinkPreviewResult is the link preview surfaced to the frontend.
type LinkPreviewResult struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Thumbnail   string `json:"thumbnail"` // data URL, or empty
}

// GetLinkPreview returns the stored preview card for a message's URL, or nil.
func (a *Api) GetLinkPreview(messageID string) *LinkPreviewResult {
	if a.messageStore == nil {
		return nil
	}
	lp := a.messageStore.GetLinkPreview(messageID)
	if lp == nil {
		return nil
	}
	res := &LinkPreviewResult{URL: lp.URL, Title: lp.Title, Description: lp.Description}
	if len(lp.Thumbnail) > 0 {
		res.Thumbnail = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(lp.Thumbnail)
	}
	return res
}

// GetLinkPreviewImage returns the preview poster as a data URL, downloading and
// caching it on first request (WhatsApp ships the poster as an encrypted
// reference rather than embedded). Empty string if there's nothing to fetch.
func (a *Api) GetLinkPreviewImage(messageID string) string {
	if a.messageStore == nil {
		return ""
	}
	m := a.messageStore.GetLinkPreviewMedia(messageID)
	if m == nil {
		return ""
	}
	if len(m.Thumbnail) > 0 {
		return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(m.Thumbnail)
	}
	if m.DirectPath == "" || len(m.MediaKey) == 0 {
		return ""
	}
	if a.waClient == nil {
		return ""
	}
	data, err := a.waClient.DownloadMediaWithPath(
		a.ctx, m.DirectPath, m.FileEncSHA256, m.FileSHA256, m.MediaKey,
		whatsmeow.MediaLinkThumbnail, "thumbnail-link", true,
	)
	if err != nil || len(data) == 0 {
		return ""
	}
	a.messageStore.CacheLinkPreviewThumbnail(messageID, data)
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data)
}

// GetVideoThumbnail returns the message's embedded preview image as a data URL,
// or an empty string if none was stored. Lets the UI show a video preview + play
// button without downloading the full video.
func (a *Api) GetVideoThumbnail(messageID string) string {
	if a.messageStore == nil {
		return ""
	}
	thumb := a.messageStore.GetThumbnail(messageID)
	if len(thumb) == 0 {
		return ""
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumb)
}

// GetCachedMedia returns the data URL for any media (image, audio, video) already cached on disk.
func (a *Api) GetCachedMedia(messageID string) (string, error) {
	if a.imageCache == nil {
		return "", fmt.Errorf("image cache is not ready")
	}
	data, mime, err := a.imageCache.ReadImageByMessageID(messageID)
	if err != nil || len(data) == 0 {
		return "", fmt.Errorf("media not cached")
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func (a *Api) DownloadMedia(chatJID string, messageID string) (string, error) {
	if a.messageStore == nil {
		return "", fmt.Errorf("message store is not ready")
	}

	// Check disk cache first before hitting WhatsApp network
	if a.imageCache != nil {
		if data, mime, err := a.imageCache.ReadImageByMessageID(messageID); err == nil && len(data) > 0 {
			return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
		}
	}

	msg, err := a.messageStore.GetMessageWithMedia(chatJID, messageID)
	if err != nil || msg == nil {
		return "", fmt.Errorf("message not found")
	}
	if msg.Media == nil {
		return "", fmt.Errorf("message %s has no downloadable media", messageID)
	}
	if a.waClient == nil {
		return "", fmt.Errorf("WhatsApp client is not ready")
	}

	mime := msg.Media.GetMimetype()
	width, height := msg.Media.GetDimensions()

	mediaType := msg.Media.GetMediaType()
	if mime == "" {
		// A correct MIME is required or <video>/<audio> won't play the data URL.
		switch mediaType {
		case whatsmeow.MediaImage:
			mime = "image/jpeg"
		case whatsmeow.MediaVideo:
			mime = "video/mp4"
		case whatsmeow.MediaAudio:
			mime = "audio/ogg"
		default:
			mime = "application/octet-stream"
		}
	}
	data, err := a.waClient.Download(a.ctx, msg.Media)
	if err != nil {
		return "", fmt.Errorf("failed to download media: %v", err)
	}

	// Save to cache for all media types (images, audio/voice notes, video)
	if a.imageCache != nil {
		_, err = a.imageCache.SaveImage(messageID, data, mime, width, height)
		if err != nil {
			log.Printf("[DownloadMedia] Failed to cache media for %s: %v", messageID, err)
		}
	}

	// Return a ready-to-use data URL with the correct MIME.
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// downloadMedia downloads media from a message and returns data, mime, width, height
func (a *Api) downloadMedia(msg *store.ExtendedMessage) ([]byte, string, int, int, error) {
	if msg == nil || msg.Media == nil {
		return nil, "", 0, 0, fmt.Errorf("message has no downloadable media")
	}
	if a.waClient == nil {
		return nil, "", 0, 0, fmt.Errorf("WhatsApp client is not ready")
	}
	data, err := a.waClient.Download(a.ctx, msg.Media)
	mime := msg.Media.GetMimetype()
	if mime == "" {
		switch msg.Media.GetMediaType() {
		case whatsmeow.MediaImage:
			mime = "image/jpeg"
		case whatsmeow.MediaVideo:
			mime = "video/mp4"
		case whatsmeow.MediaAudio:
			mime = "audio/ogg"
		default:
			mime = "application/octet-stream"
		}
	}
	width, height := msg.Media.GetDimensions()

	return data, mime, width, height, err
}

func (a *Api) GetCachedImage(messageID string) (string, error) {
	if a.imageCache == nil {
		return "", fmt.Errorf("image cache is not ready")
	}
	// Try to read from cache first
	data, mime, err := a.imageCache.ReadImageByMessageID(messageID)
	if err == nil {
		return fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data)), nil
	}

	// Image not in cache, download and cache it
	if a.messageStore == nil {
		return "", fmt.Errorf("message store is not ready")
	}
	msg, err := a.messageStore.GetMessageWithMediaByID(messageID)
	if err != nil || msg == nil {
		if thumb := a.messageStore.GetThumbnail(messageID); len(thumb) > 0 {
			return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumb), nil
		}
		return "", fmt.Errorf("message not found")
	}
	if msg.Media == nil {
		if thumb := a.messageStore.GetThumbnail(messageID); len(thumb) > 0 {
			return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumb), nil
		}
		return "", fmt.Errorf("message %s has no downloadable image", messageID)
	}

	data, mime, width, height, err := a.downloadMedia(msg)
	if err != nil {
		// If download from WhatsApp servers fails (e.g. expired media or network issue),
		// fall back to the embedded JPEG thumbnail stored in the message.
		if thumb := a.messageStore.GetThumbnail(messageID); len(thumb) > 0 {
			return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumb), nil
		}
		return "", fmt.Errorf("failed to download image: %w", err)
	}

	_, err = a.imageCache.SaveImage(messageID, data, mime, width, height)
	if err != nil {
		// Don't fail, still return the data
	}

	return fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data)), nil
}

// GetCachedImages retrieves multiple cached images by message IDs (batch operation)
// Returns map of message IDs to data URLs
func (a *Api) GetCachedImages(messageIDs []string) (map[string]string, error) {
	result := make(map[string]string)
	if a.imageCache == nil {
		return result, fmt.Errorf("image cache is not ready")
	}
	metas, err := a.imageCache.GetImagesByMessageIDs(messageIDs)
	if err != nil {
		return nil, err
	}

	for msgID, meta := range metas {
		if meta != nil {
			data, mime, err := a.imageCache.ReadImageByMessageID(msgID)
			if err == nil {
				result[msgID] = fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data))
			}
		}
	}

	return result, nil
}

// GetCachedAvatar retrieves or downloads and caches an avatar for a JID
func (a *Api) GetCachedAvatar(jid string, recache bool) (string, error) {
	if a.imageCache == nil {
		return "", fmt.Errorf("image cache is not ready")
	}

	jidParsed, parseErr := types.ParseJID(jid)
	canonJIDStr := jid
	if parseErr == nil {
		if a.waClient != nil {
			canonJIDStr = canonicalUserJID(a.ctx, a.waClient, jidParsed).String()
		} else {
			canonJIDStr = jidParsed.ToNonAD().String()
		}
	}

	// Try to get cached avatar data first (direct JID, then canonical JID)
	data, mime, err := a.imageCache.ReadAvatarByJID(jid)
	if err != nil && canonJIDStr != jid {
		data, mime, err = a.imageCache.ReadAvatarByJID(canonJIDStr)
		if err == nil && !recache {
			// Populate the query key as well
			_, _ = a.imageCache.SaveAvatar(jid, data, mime)
		}
	}

	if err == nil && !recache {
		avatarDataURL := fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data))
		return avatarDataURL, nil
	}

	// Avatar not in cache, download and cache it
	if a.waClient == nil || a.waClient.Store == nil {
		return "", fmt.Errorf("WhatsApp client is not ready")
	}
	if parseErr != nil {
		return "", fmt.Errorf("invalid JID: %w", parseErr)
	}

	// Use canonical non-AD JID for WhatsApp API requests (WhatsApp rejects device JIDs)
	queryJID := jidParsed.ToNonAD()
	if a.waClient != nil {
		queryJID = canonicalUserJID(a.ctx, a.waClient, queryJID)
	}

	// Get profile picture info. Try full resolution first.
	pic, err := a.waClient.GetProfilePictureInfo(a.ctx, queryJID, &whatsmeow.GetProfilePictureParams{
		Preview: false,
	})
	if (err != nil || pic == nil) && queryJID.Server == types.GroupServer {
		pic, err = a.waClient.GetProfilePictureInfo(a.ctx, queryJID, &whatsmeow.GetProfilePictureParams{
			Preview:     true,
			IsCommunity: true,
		})
	}
	// Fall back to standard preview if full-resolution is not available
	if (err != nil || pic == nil) && queryJID.Server != types.GroupServer {
		pic, err = a.waClient.GetProfilePictureInfo(a.ctx, queryJID, &whatsmeow.GetProfilePictureParams{
			Preview: true,
		})
	}
	if err != nil || pic == nil {
		if recache {
			a.startBackground(func() {
				_ = a.imageCache.DeleteAvatar(jid)
				if canonJIDStr != jid {
					_ = a.imageCache.DeleteAvatar(canonJIDStr)
				}
			})
		}
		return "", nil // No avatar available
	}

	dataURL, dlErr := a.downloadAvatarFromURL(jid, pic.URL)
	if dlErr == nil && canonJIDStr != jid {
		// Also cache under canonical JID if different
		rawBytes, rawMime, rErr := a.imageCache.ReadAvatarByJID(jid)
		if rErr == nil {
			_, _ = a.imageCache.SaveAvatar(canonJIDStr, rawBytes, rawMime)
		}
	}
	return dataURL, dlErr
}

// downloadAvatarFromURL fetches an avatar image from URL, caches it, and
// returns a data URL. Used by both regular and community avatar paths.
func (a *Api) downloadAvatarFromURL(jid, url string) (string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to download avatar: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download avatar: status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read avatar data: %w", err)
	}

	mime := resp.Header.Get("Content-Type")
	if mime == "" {
		mime = "image/jpeg"
		if len(data) > 3 {
			switch {
			case data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47:
				mime = "image/png"
			case data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46:
				mime = "image/gif"
			case data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46:
				mime = "image/webp"
			}
		}
	}

	_, err = a.imageCache.SaveAvatar(jid, data, mime)
	if err != nil {
		log.Printf("[downloadAvatarFromURL] Failed to cache avatar for %s: %v", jid, err)
		return "", fmt.Errorf("failed to cache avatar: %w", err)
	}

	return fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data)), nil
}

// GetSelfAvatar retrieves the avatar of the logged-in user
//
// We need to check canonical JID as if we check store's ID, it
// contains the device ID like so:
// XXXX:45@s.whatsapp.net instead of XXXX:@s.whatsapp.net
func (a *Api) GetSelfAvatar(recache bool) (string, error) {
	if a.waClient == nil || a.waClient.Store == nil || a.waClient.Store.ID == nil {
		return "", fmt.Errorf("not logged in")
	}
	jid := canonicalUserJID(a.ctx, a.waClient, *a.waClient.Store.ID)
	selfJID := jid.String()

	avatar, err := a.GetCachedAvatar(selfJID, recache)
	if err != nil {
		log.Printf("[SelfAvatar] GetCachedAvatar failed: %v", err)
		return "", err
	}

	if avatar == "" {
		log.Printf("[SelfAvatar] WhatsApp returned no avatar for self")
		return "", nil
	}

	return avatar, nil
}

// getFileExtension returns file extension for mime type
func getFileExtension(mimeType string) string {
	cleanMime := strings.TrimSpace(strings.Split(mimeType, ";")[0])
	switch cleanMime {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "video/mp4":
		return ".mp4"
	case "video/3gpp":
		return ".3gp"
	case "video/quicktime":
		return ".mov"
	case "audio/ogg":
		return ".ogg"
	case "audio/mpeg", "audio/mp3":
		return ".mp3"
	case "audio/mp4", "audio/m4a":
		return ".m4a"
	case "audio/aac":
		return ".aac"
	case "application/pdf":
		return ".pdf"
	case "application/zip":
		return ".zip"
	case "application/msword":
		return ".doc"
	case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		return ".docx"
	case "application/vnd.ms-excel":
		return ".xls"
	case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return ".xlsx"
	default:
		if exts, err := mime.ExtensionsByType(cleanMime); err == nil && len(exts) > 0 {
			return exts[0]
		}
		return ".bin"
	}
}

// GetDownloadDirectory returns the configured download directory or ~/Downloads/Whats4L by default.
func (a *Api) GetDownloadDirectory() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}
	defaultDir := filepath.Join(homeDir, "Downloads", "Whats4L")

	s := store.GetSettings()
	var customDir string
	if d, ok := s["downloadDir"].(string); ok && strings.TrimSpace(d) != "" {
		customDir = strings.TrimSpace(d)
	} else if d, ok := s["download_dir"].(string); ok && strings.TrimSpace(d) != "" {
		customDir = strings.TrimSpace(d)
	}

	if customDir != "" {
		if strings.HasPrefix(customDir, "~/") {
			customDir = filepath.Join(homeDir, customDir[2:])
		} else if customDir == "~" {
			customDir = homeDir
		}
		return customDir
	}

	return defaultDir
}

// SetDownloadDirectory persists the custom download directory to settings.
func (a *Api) SetDownloadDirectory(dir string) error {
	s := store.GetSettings()
	if s == nil {
		s = make(map[string]any)
	}
	s["downloadDir"] = strings.TrimSpace(dir)
	return store.SaveSettings(s)
}

// SelectDownloadDirectory opens a native directory picker dialog for the download folder.
func (a *Api) SelectDownloadDirectory() (string, error) {
	currentDir := a.GetDownloadDirectory()
	_ = os.MkdirAll(currentDir, 0755)

	if a.ctx == nil {
		return "", fmt.Errorf("context not available")
	}

	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		DefaultDirectory: currentDir,
		Title:            "Select Download Directory",
	})
	if err != nil {
		return "", err
	}
	if dir != "" {
		if err := a.SetDownloadDirectory(dir); err != nil {
			return "", err
		}
	}
	return dir, nil
}

// DownloadFile downloads any media (image, document, video, audio) to the configured download folder
func (a *Api) DownloadFile(messageID string) error {
	var (
		data []byte
		mimeType string
		msg  *store.ExtendedMessage
		err  error
	)

	// Check image cache first if available
	if a.imageCache != nil {
		data, mimeType, _ = a.imageCache.ReadImageByMessageID(messageID)
	}

	// If not in cache, fetch the message and download the media directly
	if len(data) == 0 {
		if a.messageStore == nil {
			return fmt.Errorf("message store is not ready")
		}
		msg, err = a.messageStore.GetMessageWithMediaByID(messageID)
		if err != nil || msg == nil || msg.Media == nil {
			return fmt.Errorf("message %s has no downloadable media", messageID)
		}
		var width, height int
		data, mimeType, width, height, err = a.downloadMedia(msg)
		if err != nil {
			return fmt.Errorf("failed to download media: %w", err)
		}
		if a.imageCache != nil {
			_, _ = a.imageCache.SaveImage(messageID, data, mimeType, width, height)
		}
	} else if a.messageStore != nil {
		msg, _ = a.messageStore.GetMessageWithMediaByID(messageID)
	}

	fileName := ""
	if msg != nil && msg.Media != nil {
		fileName = msg.Media.GetFileName()
	}
	if fileName == "" {
		fileName = messageID + getFileExtension(mimeType)
	} else if filepath.Ext(fileName) == "" {
		fileName += getFileExtension(mimeType)
	}
	fileName = filepath.Base(fileName)

	downloadsDir := a.GetDownloadDirectory()
	_ = os.MkdirAll(downloadsDir, 0755)
	filePath := filepath.Join(downloadsDir, fileName)

	// Check if file exists and prompt for new path
	if _, err := os.Stat(filePath); err == nil {
		if a.ctx != nil && a.ctx.Value("frontend") != nil {
			if filePath, err = runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
				DefaultDirectory: downloadsDir,
				DefaultFilename:  fileName,
				Title:            "File already exists. Save as...",
			}); err != nil || filePath == "" {
				return err
			}
		}
	}

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return err
	}

	savedFileName := filepath.Base(filePath)
	a.emit("download:complete", savedFileName)
	beeep.Notify("whats4linux", "Downloaded: "+savedFileName, "")
	go func() {
		if _, err := exec.LookPath("mpg123"); err == nil {
			exec.Command("mpg123", "./beep.mp3").Run()
		}
	}()
	return nil
}

// DownloadImageToFile downloads an image or file to the Downloads folder (kept for backward compatibility)
func (a *Api) DownloadImageToFile(messageID string) error {
	return a.DownloadFile(messageID)
}

func (a *Api) ensureMediaFile(messageID string) (string, []byte, string, error) {
	downloadsDir := a.GetDownloadDirectory()
	_ = os.MkdirAll(downloadsDir, 0755)

	if a.messageStore == nil {
		return "", nil, "", fmt.Errorf("message store is not ready")
	}
	msg, err := a.messageStore.GetMessageWithMediaByID(messageID)
	if err != nil || msg == nil || msg.Media == nil {
		return "", nil, "", fmt.Errorf("message %s has no downloadable media", messageID)
	}

	fileName := msg.Media.GetFileName()
	mimeType := msg.Media.GetMimetype()
	if mimeType == "" {
		mimeType = "application/pdf"
	}
	if fileName == "" {
		fileName = messageID + getFileExtension(mimeType)
	} else if filepath.Ext(fileName) == "" {
		fileName += getFileExtension(mimeType)
	}
	fileName = filepath.Base(fileName)
	filePath := filepath.Join(downloadsDir, fileName)

	// If file already exists on disk and is non-empty, use it
	if info, err := os.Stat(filePath); err == nil && info.Size() > 0 {
		data, _ := os.ReadFile(filePath)
		return filePath, data, mimeType, nil
	}

	// Also check legacy ~/Downloads in case it was previously saved there
	if homeDir, err := os.UserHomeDir(); err == nil {
		legacyPath := filepath.Join(homeDir, "Downloads", fileName)
		if legacyPath != filePath {
			if info, err := os.Stat(legacyPath); err == nil && info.Size() > 0 {
				data, _ := os.ReadFile(legacyPath)
				return legacyPath, data, mimeType, nil
			}
		}
	}

	// Download from WhatsApp
	data, mimeType, width, height, err := a.downloadMedia(msg)
	if err != nil {
		return "", nil, "", fmt.Errorf("failed to download media: %w", err)
	}

	if a.imageCache != nil {
		_, _ = a.imageCache.SaveImage(messageID, data, mimeType, width, height)
	}

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return "", nil, "", err
	}

	return filePath, data, mimeType, nil
}

// OpenDocument downloads the document if needed and opens it with the default system application (e.g. PDF viewer)
func (a *Api) OpenDocument(messageID string) error {
	filePath, _, _, err := a.ensureMediaFile(messageID)
	if err != nil {
		return err
	}
	cmd := exec.Command("xdg-open", filePath)
	return cmd.Start()
}

// OpenDocumentInBrowser downloads the document if needed and opens it in the default web browser
func (a *Api) OpenDocumentInBrowser(messageID string) error {
	filePath, _, _, err := a.ensureMediaFile(messageID)
	if err != nil {
		return err
	}
	if a.ctx != nil {
		runtime.BrowserOpenURL(a.ctx, "file://"+filePath)
		return nil
	}
	return exec.Command("xdg-open", filePath).Start()
}

// GetDocumentDataURL returns the document as a data URL for in-app preview
func (a *Api) GetDocumentDataURL(messageID string) (string, error) {
	_, data, mimeType, err := a.ensureMediaFile(messageID)
	if err != nil {
		return "", err
	}
	if mimeType == "" {
		mimeType = "application/pdf"
	}
	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(data)), nil
}

