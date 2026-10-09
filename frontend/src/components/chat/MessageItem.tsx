import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react"
import { store } from "../../../wailsjs/go/models"
import {
  DownloadFile,
  DownloadImageToFile,
  GetCachedAvatar,
  SendReaction,
  SetMessagePinned,
  OpenDocument,
  GetDocumentDataURL,
} from "../../../wailsjs/go/api/Api"
import { MediaContent } from "./MediaContent"
import { QuotedMessage } from "./QuotedMessage"
import { ReactionBubble, ReactionDetails } from "./Reactions"
import { LinkPreview } from "./LinkPreview"
import { useUIStore, useChatStore } from "../../store"
import { PollCard } from "./PollCard"
import clsx from "clsx"
import { MessageMenu, type MessageMenuHandle } from "./MessageMenu"
import {
  ClockPendingIcon,
  SingleTickIcon,
  DoubleTickIcon,
  BlueTickIcon,
  ForwardedIcon,
  UserAvatar,
} from "../../assets/svgs/chat_icons"
import { useContactStore } from "../../store/useContactStore"
import { useMessageStore } from "../../store"
import { isMe } from "../../lib/self"
import { formatPhone, phoneFromJID, isMessageEditable } from "../../lib/utils"
import { LRUCache } from "../../lib/lruCache"
import { EventsOn } from "../../../wailsjs/runtime/runtime"
import { ContactContextMenu } from "./ContactContextMenu"

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"]
const EmojiPicker = lazy(() => import("./EmojiPickerLazy"))

interface MessageItemProps {
  message: store.DecodedMessage
  chatId: string
  firstInGroup?: boolean
  pinnedIds?: Set<string>
  sentMediaCache: React.MutableRefObject<Map<string, string>>
  onReply?: (message: store.DecodedMessage) => void
  onEdit?: (message: store.DecodedMessage) => void
  onDelete?: (message: store.DecodedMessage) => void
  onQuotedClick?: (messageId: string) => void
  highlightedMessageId?: string | null
}

// Module-level cache: one avatar lookup per sender per session, shared by
// every message row (Virtuoso mounts/unmounts rows constantly).
const senderAvatarCache = new LRUCache<string, string | null>(128, 16 * 1024 * 1024, value =>
  value ? value.length : 1,
)

function SenderAvatar({
  jid,
  onContextMenu,
  onClick,
}: {
  jid: string
  onContextMenu?: (e: React.MouseEvent) => void
  onClick?: (e: React.MouseEvent) => void
}) {
  const [url, setUrl] = useState<string | null>(senderAvatarCache.get(jid) ?? null)
  const openLightbox = useUIStore(s => s.openLightbox)

  useEffect(() => {
    if (!jid || senderAvatarCache.has(jid)) return
    let live = true
    GetCachedAvatar(jid, false)
      .then(u => {
        if (u) {
          senderAvatarCache.set(jid, u)
          if (live) setUrl(u)
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [jid])

  useEffect(() => {
    const unsub = EventsOn("wa:picture_update", (updatedJid: string) => {
      if (!updatedJid || !jid) return
      const baseJid = jid.split(":")[0]
      const updatedBase = updatedJid.split(":")[0]
      if (updatedJid === jid || baseJid === updatedBase) {
        senderAvatarCache.delete(jid)
        senderAvatarCache.delete(baseJid)
        GetCachedAvatar(jid, false)
          .then(u => setUrl(u || null))
          .catch(() => {})
      }
    })
    return () => unsub()
  }, [jid])

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      onClick(e)
    } else if (url) {
      e.stopPropagation()
      openLightbox(url, "image")
    }
  }

  return (
    <div
      onClick={handleClick}
      onContextMenu={onContextMenu}
      className={clsx(
        "w-7 h-7 ml-3 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 shrink-0 self-start flex items-center justify-center text-gray-500 dark:text-gray-400 [&_svg]:w-5 [&_svg]:h-5 transition-transform",
        url ? "cursor-zoom-in hover:ring-2 hover:ring-emerald-500/50" : "cursor-pointer",
      )}
      title={url ? "Click to view photo, right-click for options" : "Right-click for options"}
    >
      {url ? <img src={url} className="w-full h-full object-cover" /> : <UserAvatar />}
    </div>
  )
}

// Detect emoji-only messages so they render large without a visible change
// in bubble chrome, like WhatsApp.
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\u{FE0F}\u{200D}\s]+$/u

const formatSize = (bytes: number) => {
  if (!bytes) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

// WhatsApp-style truncation for overly long text.
const LONG_TEXT_CHARS = 280
const LONG_TEXT_LINES = 6

function isLongText(html: string): boolean {
  const stripped = html.replace(/<[^>]*>/g, "").replace(/&\w+;/g, "")
  if (!stripped.trim()) return false
  return stripped.length > LONG_TEXT_CHARS || stripped.split(/\n/).length >= LONG_TEXT_LINES
}

function ReadMoreText({ html, className }: { html: string; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  if (isLongText(html)) {
    return (
      <div className={className}>
        <div className={clsx(!expanded && "line-clamp-6")}>
          <span dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-1 text-[#53bdeb] text-xs font-medium hover:opacity-80"
        >
          {expanded ? "Read less" : "Read more"}
        </button>
      </div>
    )
  }
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

export function MessageItem({
  message,
  chatId,
  firstInGroup = true,
  pinnedIds,
  sentMediaCache,
  onReply,
  onEdit,
  onDelete,
  onQuotedClick,
  highlightedMessageId,
}: MessageItemProps) {
  const isFromMe = Boolean(message.Info.IsFromMe || isMe(message.Info.Sender) || isMe(chatId))
  const content = message.Content
  const isSticker = !!content?.stickerMessage
  const isPending = (message as any).isPending || false
  const isGroup = chatId.endsWith("@g.us")
  // Empty for @lid senders — those JIDs carry no phone number.
  const senderPhone = formatPhone(phoneFromJID(message.Info.Sender))
  // Seed sender name/color from the cache synchronously so a cached group
  // message renders correctly on first paint and never re-renders for it.
  const cachedSender =
    !isFromMe && isGroup && message.Info.Sender
      ? useContactStore.getState().contacts[message.Info.Sender]
      : undefined
  const [senderName, setSenderName] = useState(
    cachedSender?.name || "~ " + message.Info.PushName || "Unknown",
  )
  const [senderColor, setSenderColor] = useState<string | undefined>(cachedSender?.senderColor)
  const getSenderInfo = useContactStore(state => state.getSenderInfo)
  const addReactionToMessage = useMessageStore(state => state.addReactionToMessage)
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const [showFullEmoji, setShowFullEmoji] = useState(false)
  const [showReactionDetails, setShowReactionDetails] = useState(false)
  const [textExpanded, setTextExpanded] = useState(false)
  const reactionPillRef = useRef<HTMLDivElement>(null)
  // Derived directly from the message; no state/effect needed (a state+effect
  // here forced an extra re-render per message on mount).
  const reactions = message.reactions ?? []

  // Helper function to render caption with markdown
  const renderCaption = (caption: string | undefined) => {
    if (!caption) return null
    return <ReadMoreText html={caption} className="mt-1" />
  }

  const openPdf = useUIStore(state => state.openPdf)
  const openForwardModal = useUIStore(state => state.openForwardModal)
  const openProfileModal = useUIStore(state => state.openProfileModal)
  const openLightbox = useUIStore(state => state.openLightbox)
  const selectChat = useChatStore(state => state.selectChat)
  const [senderContextMenu, setSenderContextMenu] = useState<{
    x: number
    y: number
  } | null>(null)
  const menuHandleRef = React.useRef<MessageMenuHandle>(null)
  const [downloadingDoc, setDownloadingDoc] = useState(false)
  const [openingDoc, setOpeningDoc] = useState(false)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    menuHandleRef.current?.openAt(e.clientX, e.clientY)
  }

  const handleDocClick = async () => {
    if (openingDoc) return
    setOpeningDoc(true)
    try {
      const fileName = message.Content?.documentMessage?.fileName || "Document"
      const isPdf =
        fileName.toLowerCase().endsWith(".pdf") ||
        message.Content?.documentMessage?.mimetype === "application/pdf"
      if (isPdf) {
        const dataUrl = await GetDocumentDataURL(message.Info.ID)
        if (dataUrl) {
          openPdf({ src: dataUrl, title: fileName, messageId: message.Info.ID })
          return
        }
      }
      await OpenDocument(message.Info.ID)
    } catch (e) {
      console.error("Failed to preview document, trying system open:", e)
      try {
        await OpenDocument(message.Info.ID)
      } catch (err2) {
        console.error("Failed to open externally:", err2)
      }
    } finally {
      setOpeningDoc(false)
    }
  }

  const handleDocOpenExternal = async () => {
    try {
      await OpenDocument(message.Info.ID)
    } catch (e) {
      console.error("Failed to open externally:", e)
    }
  }

  const handleImageDownload = async () => {
    try {
      await DownloadImageToFile(message.Info.ID)
    } catch (e) {
      console.error("Failed to download image:", e)
    }
  }

  const handleDocDownload = async () => {
    if (downloadingDoc) return
    setDownloadingDoc(true)
    try {
      await DownloadFile(message.Info.ID)
    } catch (e) {
      console.error("Failed to download document:", e)
    } finally {
      setDownloadingDoc(false)
    }
  }

  const handleReply = () => onReply?.(message)

  const handleCopy = () => {
    const textToCopy = content?.conversation || content?.extendedTextMessage?.text || ""
    if (textToCopy) {
      const div = document.createElement("div")
      div.innerHTML = textToCopy
      navigator.clipboard.writeText(div.innerText)
    }
  }

  const handleReact = () => setShowReactionPicker(v => !v)

  const myReaction = (reactions as any[]).find(r => isMe(r.sender_id))?.emoji as string | undefined

  const sendReaction = (emoji: string) => {
    // Tapping the emoji you already reacted with removes it (WhatsApp behaviour).
    const finalEmoji = myReaction === emoji ? "" : emoji
    // For our own messages the reaction key's sender is us (empty -> backend
    // fills in own JID); for received messages it's the original sender.
    const senderJID = isFromMe ? "" : message.Info.Sender
    SendReaction(chatId, senderJID, message.Info.ID, finalEmoji).catch(() => {})
    addReactionToMessage(chatId, message.Info.ID, finalEmoji, "me")
    setShowReactionPicker(false)
    setShowFullEmoji(false)
  }

  const isPinned = pinnedIds?.has(message.Info.ID) ?? false

  const handlePin = () => {
    SetMessagePinned(chatId, message.Info.Sender, message.Info.ID, isFromMe, !isPinned).catch(err =>
      console.error("Failed to toggle message pin:", err),
    )
  }

  // Fetch group member name + color from the cached store (one RPC per sender,
  // then synchronous) so scrolling a group chat doesn't fire an RPC per row.
  useEffect(() => {
    if (isFromMe || !isGroup || !message.Info.Sender) return
    // Already seeded from cache above — no fetch, no re-render.
    if (useContactStore.getState().contacts[message.Info.Sender]) return
    let cancelled = false
    getSenderInfo(message.Info.Sender)
      .then(({ name, color }) => {
        if (cancelled) return
        if (name) setSenderName(name)
        if (color) setSenderColor(color)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [message.Info.Sender, isGroup, isFromMe, getSenderInfo])

  const contextInfo =
    content?.extendedTextMessage?.contextInfo ||
    content?.imageMessage?.contextInfo ||
    content?.videoMessage?.contextInfo ||
    content?.audioMessage?.contextInfo ||
    content?.documentMessage?.contextInfo ||
    content?.stickerMessage?.contextInfo

  const isTextContent = !!(content?.conversation || content?.extendedTextMessage?.text)

  // Intl formatting is relatively expensive — compute once per timestamp.
  const timeStr = useMemo(
    () =>
      new Date(message.Info.Timestamp).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    [message.Info.Timestamp],
  )

  const renderDeliveryIcon = () => {
    if (!isFromMe) return null
    if (isPending || message.delivery_status === "pending") {
      return <ClockPendingIcon />
    }
    const status = message.delivery_status || "sent"
    if (status === "read") {
      return <BlueTickIcon />
    }
    if (status === "delivered") {
      return <DoubleTickIcon />
    }
    return <SingleTickIcon />
  }

  // Inline metadata (time + ticks). For text messages it floats into the last
  // line WhatsApp-style; for media/documents it renders as a bottom row.
  const timeMeta = (floated: boolean) => (
    <span
      className={clsx(
        "inline-flex items-center gap-1 text-[11px] leading-none opacity-60 select-none whitespace-nowrap",
        floated && "float-right ml-2 mt-2",
      )}
    >
      {message.edited && (
        <span className="select-none">
          Edited
        </span>
      )}
      <span>{timeStr}</span>
      {renderDeliveryIcon()}
    </span>
  )

  const renderContent = () => {
    if (!content) return <span className="italic opacity-50">Empty Message</span>
    else if (content.conversation || content.extendedTextMessage?.text) {
      // Structured poll data supersedes the static HTML card so polls can be
      // voted on right from the app. Also never given Read more treatment.
      if (message.poll) {
        return (
          <div className="flow-root">
            <PollCard
              pollName={message.poll.name}
              options={message.poll.options}
              selectableCount={message.poll.selectableCount}
              messageId={message.Info.ID}
              votes={message.poll.votes}
            />
            {timeMeta(true)}
          </div>
        )
      }
      const htmlContent = content.conversation || content.extendedTextMessage?.text || ""
      const stripped = htmlContent
        .replace(/<[^>]*>/g, "")
        .replace(/&\w+;/g, "")
        .trim()
      const emojiOnly = stripped.length > 0 && stripped.length <= 16 && EMOJI_ONLY_RE.test(stripped)
      // Polls and other special HTML cards should never get Read more treatment.
      const isPoll = htmlContent.includes("msg-poll") || htmlContent.includes("msg-card")
      const long = !emojiOnly && !isPoll && isLongText(htmlContent)
      return (
        <>
          <div className={clsx("flow-root", emojiOnly && "text-[32px] leading-10")}>
            {long && !textExpanded ? (
              <div className="line-clamp-6">
                <span dangerouslySetInnerHTML={{ __html: htmlContent }} />
              </div>
            ) : (
              <span dangerouslySetInnerHTML={{ __html: htmlContent }} />
            )}
            {long && !textExpanded ? (
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  onClick={() => setTextExpanded(true)}
                  className="text-[#53bdeb] text-xs font-medium leading-none hover:opacity-80"
                >
                  Read more
                </button>
                {timeMeta(false)}
              </div>
            ) : (
              <>
                {timeMeta(true)}
                {long && (
                  <button
                    onClick={() => setTextExpanded(false)}
                    className="mt-1 block text-[#53bdeb] text-xs font-medium hover:opacity-80"
                  >
                    Read less
                  </button>
                )}
              </>
            )}
          </div>
          {htmlContent.includes('class="msg-link"') && (
            <LinkPreview messageId={message.Info.ID} preview={message.link_preview ?? null} />
          )}
        </>
      )
    } else if (content.imageMessage)
      return (
        <div className="flex flex-col">
          <MediaContent
            message={message}
            type="image"
            chatId={chatId}
            sentMediaCache={sentMediaCache}
            onDownload={handleImageDownload}
          />
          {renderCaption(content.imageMessage.caption)}
        </div>
      )
    else if (content.videoMessage)
      return (
        <div className="flex flex-col">
          <MediaContent
            message={message}
            type="video"
            chatId={chatId}
            isGif={!!content.videoMessage.gifPlayback}
            sentMediaCache={sentMediaCache}
          />
          {renderCaption(content.videoMessage.caption)}
        </div>
      )
    else if (content.audioMessage)
      return (
        <MediaContent
          message={message}
          type="audio"
          chatId={chatId}
          sentMediaCache={sentMediaCache}
        />
      )
    else if (content.stickerMessage)
      return (
        <MediaContent
          message={message}
          type="sticker"
          chatId={chatId}
          sentMediaCache={sentMediaCache}
        />
      )
    else if (content.documentMessage) {
      const doc = content.documentMessage
      const fileName = doc.fileName || "Document"
      const extension = fileName.split(".").pop()?.toUpperCase() || "FILE"
      // fileLength is not available in DecodedMessageContent, show "Unknown size"
      const fileSize = 0

      return (
        <div className="flex flex-col">
          <div
            onClick={handleDocClick}
            className="flex items-center gap-3 bg-black/5 dark:bg-white/5 p-2 rounded-lg min-w-64 cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 transition-colors group/doc"
            title="Click to preview or open document"
          >
            <div className="w-10 h-12 bg-red-500 rounded flex items-center justify-center text-white font-bold text-[10px] relative shrink-0">
              <div className="absolute top-0 right-0 border-t-10 border-r-10 border-t-white/20 border-r-transparent"></div>
              {openingDoc ? (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
              ) : (
                extension.slice(0, 4)
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="truncate font-medium text-sm text-gray-900 dark:text-gray-100 group-hover/doc:text-green-600 dark:group-hover/doc:text-green-400 transition-colors">
                {fileName}
              </div>
              <div className="text-xs opacity-60 text-gray-500 dark:text-gray-400">
                {fileSize > 0 ? formatSize(fileSize) : "Click to view / open"}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
              <button
                onClick={handleDocOpenExternal}
                className="p-2 border border-gray-300 dark:border-gray-600 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-gray-600 dark:text-gray-300"
                title="Open with default system viewer"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
              <button
                onClick={handleDocDownload}
                disabled={downloadingDoc}
                className="p-2 border border-gray-300 dark:border-gray-600 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                title="Download document"
              >
                {downloadingDoc ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-500" />
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    className="fill-current text-gray-600 dark:text-gray-300"
                  >
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          {renderCaption(doc.caption)}
        </div>
      )
    }
    // Note: senderKeyDistributionMessage and reactionMessage are not stored in messages.db
    // Reactions are stored separately and shown via the Reactions field
    return <span className="italic opacity-50 text-xs">Unsupported Message Type</span>
  }

  const hasMedia = !!(content?.imageMessage || content?.videoMessage)

  return (
    <>
      <div
        onContextMenu={handleContextMenu}
        className={clsx(
          "flex group",
          isFromMe ? "justify-end" : "justify-start",
          // Reserve room for the reaction pill overhanging the bubble bottom.
          reactions.length > 0 && "mb-3",
          {
            // Transition scoped to the highlighted row only — a blanket
            // transition on every row makes scrolling more expensive.
            "bg-[#21C063]/50 dark:bg-[#21C063]/40 transition-colors duration-200":
              highlightedMessageId === message.Info.ID,
          },
        )}
      >
        {/* Sender avatar column (group chats, received): avatar on the first
            message of a run, an equally wide spacer on the rest. */}
        {!isFromMe &&
          isGroup &&
          (firstInGroup ? (
            <SenderAvatar
              jid={message.Info.Sender}
              onClick={e => {
                const avatar = senderAvatarCache.get(message.Info.Sender)
                if (avatar) {
                  e.stopPropagation()
                  openLightbox(avatar, "image")
                } else {
                  e.stopPropagation()
                  openProfileModal(message.Info.Sender)
                }
              }}
              onContextMenu={e => {
                e.preventDefault()
                e.stopPropagation()
                setSenderContextMenu({ x: e.clientX, y: e.clientY })
              }}
            />
          ) : (
            <div className="w-7 ml-3 shrink-0" />
          ))}
        <div
          onContextMenu={handleContextMenu}
          onDoubleClick={handleReply}
          className={clsx(
            "max-w-[85%] lg:max-w-[65%] rounded-xl px-2 pt-1 pb-1.5 relative min-w-0",
            !isFromMe && isGroup ? "ml-2 mr-5" : "mx-5",
            {
              "w-min": hasMedia,
              "bg-transparent shadow-none": isSticker,
              // WhatsApp sharpens the corner facing the sender on the first
              // bubble of a run.
              "rounded-tl-sm": firstInGroup && !isFromMe && !isSticker,
              "rounded-tr-sm": firstInGroup && isFromMe && !isSticker,

              // SENT
              "bg-sent-bubble-bg dark:bg-sent-bubble-dark-bg text-(--color-sent-bubble-text) dark:text-(--color-sent-bubble-dark-text)":
                isFromMe && !isSticker,

              // RECEIVED
              "bg-received-bubble-bg dark:bg-received-bubble-dark-bg text-(--color-received-bubble-text) dark:text-(--color-received-bubble-dark-text)":
                !isFromMe && !isSticker,
            },
          )}
        >
          {/* Hover reaction trigger just outside the bubble (WhatsApp-style). */}
          <button
            onClick={() => setShowReactionPicker(v => !v)}
            title="React"
            className={clsx(
              "absolute bottom-1 z-20 rounded-full bg-white p-1 text-sm leading-none opacity-0 shadow transition-opacity group-hover:opacity-100 dark:bg-dark-tertiary",
              isFromMe ? "-left-9" : "-right-9",
            )}
          >
            🙂
          </button>

          {showReactionPicker && (
            <div
              className={clsx(
                "absolute bottom-9 z-9999 flex w-max items-center gap-1 rounded-full bg-white px-2 py-1 shadow-lg dark:bg-dark-tertiary",
                isFromMe ? "right-0" : "left-0",
              )}
            >
              {QUICK_REACTIONS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => sendReaction(emoji)}
                  className={clsx(
                    "rounded-full px-1 text-lg leading-none transition-transform hover:scale-125",
                    myReaction === emoji && "bg-blue-500/40",
                  )}
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={() => {
                  setShowFullEmoji(true)
                  setShowReactionPicker(false)
                }}
                title="More"
                className="ml-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/10 text-sm dark:bg-white/10"
              >
                +
              </button>
            </div>
          )}

          {showFullEmoji && (
            <div className="absolute bottom-9 z-9999" style={isFromMe ? { right: 0 } : { left: 0 }}>
              <Suspense
                fallback={
                  <div className="rounded bg-white p-2 text-xs shadow dark:bg-dark-tertiary">
                    Loading…
                  </div>
                }
              >
                <EmojiPicker
                  onEmojiSelect={(e: any) => sendReaction(e.native)}
                  onClickOutside={() => setShowFullEmoji(false)}
                  theme="auto"
                  previewPosition="none"
                  skinTonePosition="none"
                />
              </Suspense>
            </div>
          )}
          {/* Message Menu - positioned at top right corner */}
          <MessageMenu
            ref={menuHandleRef}
            messageId={message.Info.ID}
            isFromMe={isFromMe}
            isPinned={isPinned}
            canEdit={isMessageEditable(message)}
            onPin={handlePin}
            onReply={handleReply}
            onCopy={handleCopy}
            onReact={handleReact}
            onForward={() => openForwardModal(message.Info.ID)}
            onEdit={onEdit ? () => onEdit(message) : undefined}
            onDelete={onDelete ? () => onDelete(message) : undefined}
          />

          {!isFromMe && chatId.endsWith("@g.us") && firstInGroup && (
            <div className="flex items-baseline justify-between gap-4 mb-0.5 pt-0.5">
              <span
                onClick={e => {
                  e.stopPropagation()
                  openProfileModal(message.Info.Sender)
                }}
                onContextMenu={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  setSenderContextMenu({ x: e.clientX, y: e.clientY })
                }}
                className="text-[11px] font-semibold truncate cursor-pointer hover:underline"
                style={{ color: senderColor }}
                title="Click to view profile, right-click for options"
              >
                {senderName}
              </span>
              {/* WhatsApp shows the phone number next to the name for senders
                  that aren't saved contacts (pushName-only, "~"-prefixed). */}
              {senderName.startsWith("~") && senderPhone && (
                <span className="shrink-0 text-[11px] text-black/40 dark:text-white/40 font-mono">
                  {senderPhone}
                </span>
              )}
            </div>
          )}
          {message.forwarded && (
            <div className="text-[10px] flex gap-1 italic items-center opacity-60 mb-1">
              <ForwardedIcon />
              Forwarded
            </div>
          )}
          {contextInfo?.quotedMessage && (
            <QuotedMessage contextInfo={contextInfo} onQuotedClick={onQuotedClick} />
          )}
          <div className="text-sm wrap-break-words whitespace-pre-wrap">{renderContent()}</div>
          {!isTextContent && <div className="mt-1 flex justify-end">{timeMeta(false)}</div>}

          {/* Reactions */}
          {reactions.length > 0 && (
            <div
              ref={reactionPillRef}
              onClick={() => setShowReactionDetails(true)}
              className={clsx(
                "absolute -bottom-3 z-9999 cursor-pointer",
                isFromMe ? "right-2" : "left-2",
              )}
            >
              <ReactionBubble reactions={reactions} isFromMe={isFromMe} />
            </div>
          )}

          {showReactionDetails && reactions.length > 0 && (
            <ReactionDetails
              reactions={reactions}
              isFromMe={isFromMe}
              messageText={(content?.conversation || content?.extendedTextMessage?.text || "")
                .replace(/<[^>]*>/g, "")
                .replace(/&\w+;/g, "")}
              anchorRef={reactionPillRef}
              onClose={() => setShowReactionDetails(false)}
            />
          )}
        </div>
      </div>

      {senderContextMenu && (
        <ContactContextMenu
          x={senderContextMenu.x}
          y={senderContextMenu.y}
          contactName={senderName}
          hasAvatar={!!senderAvatarCache.get(message.Info.Sender)}
          onClose={() => setSenderContextMenu(null)}
          onMessageDirectly={() => {
            selectChat({
              id: message.Info.Sender.split(":")[0],
              name: senderName,
              avatar: senderAvatarCache.get(message.Info.Sender) || undefined,
            })
          }}
          onViewProfile={() => {
            openProfileModal(message.Info.Sender)
          }}
          onViewPhoto={
            senderAvatarCache.get(message.Info.Sender)
              ? () =>
                  openLightbox(
                    senderAvatarCache.get(message.Info.Sender)!,
                    "image",
                  )
              : undefined
          }
          onCopyPhone={() => {
            navigator.clipboard.writeText(senderPhone || message.Info.Sender)
          }}
        />
      )}
    </>
  )
}

export const MessagePreview = () => {
  return (
    <div className="flex flex-col gap-3 w-65">
      <div className="flex justify-start">
        <div
          className="max-w-[80%] px-3 py-2 rounded-lg text-sm shadow-sm
            bg-received-bubble-bg dark:bg-received-bubble-dark-bg 
            text-received-bubble-text dark:text-received-bubble-dark-text"
        >
          hey 👋
        </div>
      </div>
      <div className="flex justify-end">
        <div
          className="max-w-[80%] px-3 py-2 rounded-lg text-sm shadow-sm
            bg-sent-bubble-bg dark:bg-sent-bubble-dark-bg 
            text-sent-bubble-text dark:text-sent-bubble-dark-text"
        >
          what's up 😎
        </div>
      </div>
    </div>
  )
}
