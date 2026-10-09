package types

import "github.com/polymorfa/hypermeow"

type MediaType uint8

const (
	MediaTypeNone MediaType = iota
	MediaTypeImage
	MediaTypeVideo
	MediaTypeAudio
	MediaTypeDocument
	MediaTypeSticker
	MediaTypeStickerMetadata
	MediaTypeStickerPack
	MediaTypeHistorySync
	MediaTypeAppState
)

var GeneralMediaMap = map[MediaType]whatsmeow.MediaType{
	MediaTypeImage:           whatsmeow.MediaImage,
	MediaTypeAudio:           whatsmeow.MediaAudio,
	MediaTypeVideo:           whatsmeow.MediaVideo,
	MediaTypeDocument:        whatsmeow.MediaDocument,
	MediaTypeSticker:         whatsmeow.MediaImage,
	MediaTypeStickerMetadata: whatsmeow.MediaImage,

	MediaTypeStickerPack: whatsmeow.MediaStickerPack,
	MediaTypeHistorySync: whatsmeow.MediaHistory,
	MediaTypeAppState:    whatsmeow.MediaAppState,
}
