import React, { lazy, Suspense, useState, useRef, useEffect } from "react"
import clsx from "clsx"
import {
  EmojiIcon,
  AttachIcon,
  SendIcon,
  CloseIcon,
  UserAvatar,
  MicIcon,
  TrashIcon,
} from "../../assets/svgs/chat_icons"
import { store } from "../../../wailsjs/go/models"
import { GetCachedAvatar } from "../../../wailsjs/go/api/Api"
import { useContactStore } from "../../store/useContactStore"
import { PollDialog } from "./PollDialog"
import { ContactShareDialog } from "./ContactShareDialog"

const EmojiPicker = lazy(() => import("./EmojiPickerLazy"))
interface ChatInputProps {
  chatId: string
  inputText: string
  pastedImage: string | null
  selectedFile: File | null
  selectedFileType: string
  showEmojiPicker: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  emojiPickerRef: React.RefObject<HTMLDivElement | null>
  emojiButtonRef: React.RefObject<HTMLButtonElement | null>
  replyingTo: store.DecodedMessage | null
  editingMessage?: store.DecodedMessage | null
  mentionableContacts: any[]
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onSendMessage: () => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRemoveFile: () => void
  onEmojiClick: (emoji: string) => void
  onToggleEmojiPicker: () => void
  onCancelReply: () => void
  onCancelEdit?: () => void
  onMentionAdd: (contact: any) => void
  selectedMentions: any[]
  onSendVoiceNote?: (base64Data: string, mimetype: string, durationSeconds: number) => void
}

const FILE_TYPE_ICONS = {
  image: "📷",
  video: "🎥",
  audio: "🎵",
  document: "📄",
} as const

interface IconButtonProps {
  onClick: () => void
  title: string
  children: React.ReactNode
  ref?: React.RefObject<HTMLButtonElement>
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ onClick, title, children }, ref) => (
    <button
      ref={ref}
      onClick={onClick}
      className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
      title={title}
    >
      {children}
    </button>
  ),
)
IconButton.displayName = "IconButton"

interface FilePreviewProps {
  file: File
  fileType: string
  onRemove: () => void
}

const FilePreview = ({ file, fileType, onRemove }: FilePreviewProps) => (
  <div className="mb-2 flex items-center rounded-xl gap-2 bg-gray-100 dark:bg-gray-700 p-2 rounded-lg">
    <div className="flex-1">
      <div className="flex items-center gap-2">
        {FILE_TYPE_ICONS[fileType as keyof typeof FILE_TYPE_ICONS]}
        <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{file.name}</span>
      </div>
      <span className="text-xs text-gray-500">{(file.size / 1024).toFixed(2)} KB</span>
    </div>
    <button onClick={onRemove} className="text-red-500 hover:text-red-600 p-1" title="Remove file">
      ×
    </button>
  </div>
)

interface ImagePreviewProps {
  imageSrc: string
  onRemove: () => void
}

const ImagePreview = ({ imageSrc, onRemove }: ImagePreviewProps) => (
  <div className="mb-2 relative inline-block">
    <img src={imageSrc} alt="Pasted" className="max-h-40 rounded-lg" />
    <button
      onClick={onRemove}
      className={clsx(
        "absolute top-1 right-1",
        "bg-red-500 text-white rounded-full",
        "w-6 h-6 flex items-center justify-center",
        "hover:bg-red-600 transition-colors",
      )}
    >
      ×
    </button>
  </div>
)

export function ChatInput({
  chatId,
  inputText,
  pastedImage,
  selectedFile,
  selectedFileType,
  showEmojiPicker,
  textareaRef,
  fileInputRef,
  emojiPickerRef,
  emojiButtonRef,
  replyingTo,
  editingMessage,
  mentionableContacts,
  onInputChange,
  onKeyDown,
  onPaste,
  onSendMessage,
  onFileSelect,
  onRemoveFile,
  onEmojiClick,
  onToggleEmojiPicker,
  onCancelReply,
  onCancelEdit,
  onMentionAdd,
  selectedMentions,
  onSendVoiceNote,
}: ChatInputProps) {
  const [mentionSuggestions, setMentionSuggestions] = useState<any[]>([])
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [fileAccept, setFileAccept] = useState("image/*,video/*,audio/*,.pdf,.doc,.docx")
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [mentionAvatars, setMentionAvatars] = useState<Record<string, string>>({})
  const [loadingAvatars, setLoadingAvatars] = useState<Record<string, boolean>>({})
  const [isMultiline, setIsMultiline] = useState(false)

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [recordingError, setRecordingError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const shouldSendAudioRef = useRef(false)
  const recordingDurationRef = useRef(0)

  const avatarCacheRef = useRef<Record<string, string>>({})
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  // Auto-resize textarea and keep backdrop height synchronized
  useEffect(() => {
    const el = textareaRef?.current
    if (!el) return

    // Reset height to auto to recalculate actual scrollHeight
    el.style.height = "auto"
    const scrollHeight = el.scrollHeight

    // Minimum single-line height ~36px, max ~140px (~5-6 lines)
    const targetHeight = Math.min(Math.max(scrollHeight, 36), 140)
    el.style.height = `${targetHeight}px`
    setIsMultiline(scrollHeight > 44)

    if (backdropRef.current) {
      backdropRef.current.style.height = `${targetHeight}px`
      backdropRef.current.scrollTop = el.scrollTop
    }
  }, [inputText, textareaRef])

  const handleScroll = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s < 10 ? "0" : ""}${s}`
  }

  const startVoiceRecording = async () => {
    setRecordingError(null)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setRecordingError("Microphone not supported on this device.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioStreamRef.current = stream

      let mimeType = "audio/webm; codecs=opus"
      if (typeof MediaRecorder.isTypeSupported === "function") {
        if (MediaRecorder.isTypeSupported("audio/ogg; codecs=opus")) {
          mimeType = "audio/ogg; codecs=opus"
        } else if (MediaRecorder.isTypeSupported("audio/webm; codecs=opus")) {
          mimeType = "audio/webm; codecs=opus"
        } else if (MediaRecorder.isTypeSupported("audio/webm")) {
          mimeType = "audio/webm"
        }
      }

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []
      shouldSendAudioRef.current = false
      recordingDurationRef.current = 0
      setRecordingDuration(0)

      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data)
        }
      }

      recorder.onstop = () => {
        if (shouldSendAudioRef.current && audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: mimeType })
          const duration = recordingDurationRef.current
          const reader = new FileReader()
          reader.onloadend = () => {
            const result = reader.result as string
            if (result && onSendVoiceNote) {
              const base64 = result.split(",")[1]
              onSendVoiceNote(base64, mimeType, Math.max(duration, 1))
            }
          }
          reader.readAsDataURL(blob)
        }

        stream.getTracks().forEach(track => track.stop())
        audioStreamRef.current = null
        mediaRecorderRef.current = null
        setIsRecording(false)
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current)
          recordingTimerRef.current = null
        }
      }

      recorder.start(200)
      setIsRecording(true)

      recordingTimerRef.current = setInterval(() => {
        recordingDurationRef.current += 1
        setRecordingDuration(recordingDurationRef.current)
      }, 1000)
    } catch (err: any) {
      console.error("Failed to start voice recording:", err)
      let msg = err?.message || "Microphone access denied"
      if (err?.name === "NotAllowedError" || msg.includes("not allowed")) {
        msg = "Microphone permission was blocked. Restart the app to apply permissions."
      } else if (err?.name === "NotFoundError" || msg.includes("NotFound")) {
        msg = "No microphone input device detected on your system."
      }
      setRecordingError(msg)
      setTimeout(() => setRecordingError(null), 5000)
    }
  }

  const cancelVoiceRecording = () => {
    shouldSendAudioRef.current = false
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    } else {
      audioStreamRef.current?.getTracks().forEach(track => track.stop())
      audioStreamRef.current = null
      setIsRecording(false)
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }

  const finishVoiceRecording = () => {
    shouldSendAudioRef.current = true
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      audioStreamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const renderHighlightedText = () => {
    if (!inputText) return null
    const textWithTrailing = inputText.endsWith("\n") ? inputText + " " : inputText
    if (selectedMentions.length === 0) return textWithTrailing

    const mentionNames = selectedMentions.map(m => {
      let name = m.full_name
      if (!name) {
        if (m.push_name) name = `~ ${m.push_name}`
        else name = m.short || m.phno
      }
      return "@" + name
    })
    if (mentionNames.length === 0) return textWithTrailing

    const pattern = new RegExp(`(${mentionNames.join("|")})`, "g")
    const parts = textWithTrailing.split(pattern)

    return parts.map((part, index) => {
      if (mentionNames.includes(part)) {
        return (
          <span key={index} className="text-green-500 font-medium">
            {part}
          </span>
        )
      }
      return <span key={index}>{part}</span>
    })
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    onInputChange(e)

    // Check for mention trigger
    const mentionMatch = value.match(/@(\w*)$/)
    if (mentionMatch) {
      const query = mentionMatch[1].toLowerCase()
      const matches = mentionableContacts
        .map((contact: any) => ({
          contact,
          name: (
            (contact.full_name && contact.full_name) ||
            (contact.push_name && contact.push_name) ||
            contact.short ||
            contact.phno ||
            ""
          ).toLowerCase(),
        }))
        .filter((c: any) => c.name.includes(query))
        .slice(0, 5)

      setMentionSuggestions(matches.map((m: any) => m.contact))
      setShowSuggestions(matches.length > 0)
    } else {
      setShowSuggestions(false)
    }
  }

  const handleSuggestionClick = (contact: any) => {
    let name = contact.full_name
    if (!name) {
      if (contact.push_name) {
        name = `~ ${contact.push_name}`
      } else {
        name = contact.short || contact.phno
      }
    }
    const newText = inputText.replace(/@\w*$/, `@${name} `)
    const fakeEvent = {
      target: { value: newText },
    } as React.ChangeEvent<HTMLTextAreaElement>
    onInputChange(fakeEvent)
    setShowSuggestions(false)
    onMentionAdd(contact)
  }

  const hasContent = Boolean(
    inputText.trim() || pastedImage || selectedFile || editingMessage,
  )
  const [senderName, setSenderName] = useState<string>("")
  const [senderColor, setSenderColor] = useState<string>("")
  const [loadingSenderName, setLoadingSenderName] = useState<boolean>(false)
  const getContactName = useContactStore(state => state.getContactName)
  const getContactColor = useContactStore(state => state.getContactColor)

  useEffect(() => {
    if (!replyingTo || replyingTo.Info.IsFromMe) {
      setSenderName("")
      setSenderColor("")
      setLoadingSenderName(false)
      return
    }

    const participant = replyingTo.Info.Sender
    if (participant) {
      let mounted = true
      setLoadingSenderName(true)
      getContactName(participant)
        .then((contactName: string) => {
          if (!mounted) return
          if (contactName) setSenderName(contactName)
        })
        .catch(() => {})
        .finally(() => {
          if (!mounted) return
          setLoadingSenderName(false)
        })
      getContactColor(participant)
        .then((color: string) => {
          if (!mounted) return
          if (color) setSenderColor(color)
        })
        .catch(() => {})

      return () => {
        mounted = false
      }
    }
  }, [replyingTo, getContactName, getContactColor])

  useEffect(() => {
    if (replyingTo || editingMessage) {
      const focus = () => {
        const el = textareaRef?.current
        if (el) {
          el.focus()
          const len = el.value.length
          try {
            el.setSelectionRange(len, len)
          } catch {}
        }
      }
      focus()
      requestAnimationFrame(focus)
      const t1 = setTimeout(focus, 0)
      const t2 = setTimeout(focus, 50)
      const t3 = setTimeout(focus, 180)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
        clearTimeout(t3)
      }
    }
  }, [replyingTo, editingMessage, textareaRef])

  useEffect(() => {
    const loadAvatars = async () => {
      const contactsToLoad = mentionSuggestions.filter(
        contact => !(contact.phno in avatarCacheRef.current),
      )

      if (contactsToLoad.length === 0) {
        const cached: Record<string, string> = {}
        for (const contact of mentionSuggestions) {
          cached[contact.phno] = avatarCacheRef.current[contact.phno] || ""
        }
        setMentionAvatars(cached)
        return
      }

      setLoadingAvatars(prev => {
        const next = { ...prev }
        for (const contact of contactsToLoad) {
          next[contact.phno] = true
        }
        return next
      })

      // Load avatars for contacts not in cache
      for (const contact of contactsToLoad) {
        try {
          const userJid = contact.raw_jid
          const avatar = await GetCachedAvatar(userJid, false)
          avatarCacheRef.current[contact.phno] = avatar || ""
        } catch (err) {
          console.error("Failed to load avatar for", contact.phno, err)
          avatarCacheRef.current[contact.phno] = ""
        }
      }

      // Clear loading state
      setLoadingAvatars(prev => {
        const next = { ...prev }
        for (const contact of contactsToLoad) {
          next[contact.phno] = false
        }
        return next
      })

      // Update avatars state from cache
      const updated: Record<string, string> = {}
      for (const contact of mentionSuggestions) {
        updated[contact.phno] = avatarCacheRef.current[contact.phno] || ""
      }
      setMentionAvatars(updated)
    }

    if (mentionSuggestions.length > 0) {
      loadAvatars()
    } else {
      setMentionAvatars({})
    }
  }, [mentionSuggestions])

  const handleEmojiSelect = (emoji: any) => {
    onEmojiClick(emoji.native)
  }

  const renderReplyPreview = () => {
    if (!replyingTo) return null
    const content = replyingTo.Content
    const previewText =
      content?.conversation ||
      content?.extendedTextMessage?.text ||
      (content?.imageMessage ? "📷 Photo" : undefined) ||
      (content?.videoMessage ? "🎥 Video" : undefined) ||
      (content?.audioMessage ? "🎵 Audio" : undefined) ||
      (content?.documentMessage ? "📄 Document" : undefined) ||
      (content?.stickerMessage ? "Sticker" : undefined) ||
      "Message"

    const senderLabel = replyingTo.Info.IsFromMe
      ? "You"
      : senderName || replyingTo.Info.PushName || "Contact"

    return (
      <div className="mb-2 flex items-start gap-2 rounded-md bg-black/5 dark:bg-white/10 p-2 text-xs">
        <div className="flex-1 min-w-0">
          <div
            className="font-semibold flex items-center gap-2"
            style={{ color: replyingTo.Info.IsFromMe ? undefined : senderColor }}
          >
            {loadingSenderName && (
              <span className="w-3 h-3 rounded-full border-2 border-green-600 border-t-transparent animate-spin" />
            )}
            {senderLabel}
          </div>
          <div
            className="line-clamp-2 opacity-80"
            dangerouslySetInnerHTML={{ __html: previewText }}
          />
        </div>
        <button
          onClick={onCancelReply}
          className="ml-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
          title="Cancel reply"
        >
          <CloseIcon />
        </button>
      </div>
    )
  }

  const renderEditPreview = () => {
    if (!editingMessage) return null
    const originalText =
      editingMessage.Content?.conversation ||
      editingMessage.Content?.extendedTextMessage?.text ||
      ""
    const isEmpty = !inputText.trim()

    return (
      <div
        className={clsx(
          "flex items-center justify-between p-2 rounded-lg border-l-4 text-xs transition-colors",
          isEmpty
            ? "bg-red-500/10 border-red-500"
            : "bg-green-500/10 border-green-500",
        )}
      >
        <div className="flex-1 min-w-0 pr-2">
          <div
            className={clsx(
              "font-semibold flex items-center gap-1.5 mb-0.5",
              isEmpty
                ? "text-red-600 dark:text-red-400"
                : "text-green-600 dark:text-green-400",
            )}
          >
            <span>{isEmpty ? "🗑️" : "✏️"}</span>
            <span>
              {isEmpty
                ? "Empty message — sending will delete for everyone"
                : "Edit message"}
            </span>
          </div>
          <div
            className="line-clamp-2 opacity-80 text-gray-700 dark:text-gray-300"
            dangerouslySetInnerHTML={{ __html: originalText }}
          />
        </div>
        <button
          onClick={onCancelEdit}
          className="ml-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
          title="Cancel edit (Esc)"
        >
          <CloseIcon />
        </button>
      </div>
    )
  }

  return (
    <div className="relative mx-3 mb-3 mt-1.5">
      {showEmojiPicker && (
        <div ref={emojiPickerRef} className="absolute bottom-full left-0 z-50 mb-2">
          <Suspense fallback={<div className="p-4 text-sm">Loading emojis...</div>}>
            <EmojiPicker
              onEmojiSelect={handleEmojiSelect}
              theme="auto"
              previewPosition="none"
              skinTonePosition="search"
            />
          </Suspense>
        </div>
      )}

      {/* Previews (pasted image / attached file / reply / edit) sit in a card above
          the composer pill, like WhatsApp. */}
      {(pastedImage || selectedFile || replyingTo || editingMessage) && (
        <div className="mb-2 rounded-xl border border-gray-200 bg-light-bg p-2 dark:border-transparent dark:bg-[#242626]">
          {pastedImage && <ImagePreview imageSrc={pastedImage} onRemove={onRemoveFile} />}
          {selectedFile && (
            <FilePreview file={selectedFile} fileType={selectedFileType} onRemove={onRemoveFile} />
          )}
          {renderReplyPreview()}
          {renderEditPreview()}
        </div>
      )}
      {/* Main input row: rounded pill (emoji left, attach right) with the
          send button as a separate circle outside, WhatsApp-style. */}
      {recordingError && (
        <div className="mb-2 text-xs text-red-500 bg-red-100 dark:bg-red-900/30 px-3 py-1.5 rounded-lg">
          {recordingError}
        </div>
      )}

      {isRecording ? (
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center justify-between rounded-full border border-red-500/30 bg-red-50/60 px-4 py-2 dark:border-red-500/20 dark:bg-red-950/25">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono text-sm font-semibold text-red-600 dark:text-red-400">
                {formatTimer(recordingDuration)}
              </span>
              <div className="flex items-center gap-1 ml-2">
                <span className="h-2 w-0.5 rounded-full bg-red-400 animate-pulse" style={{ animationDelay: "0ms" }} />
                <span className="h-4 w-0.5 rounded-full bg-red-500 animate-pulse" style={{ animationDelay: "150ms" }} />
                <span className="h-3 w-0.5 rounded-full bg-red-400 animate-pulse" style={{ animationDelay: "300ms" }} />
                <span className="h-5 w-0.5 rounded-full bg-red-500 animate-pulse" style={{ animationDelay: "450ms" }} />
                <span className="h-2 w-0.5 rounded-full bg-red-400 animate-pulse" style={{ animationDelay: "200ms" }} />
              </div>
            </div>
            <button
              onClick={cancelVoiceRecording}
              className="text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 p-1.5 transition-colors"
              title="Cancel recording"
            >
              <TrashIcon />
            </button>
          </div>
          <button
            onClick={finishVoiceRecording}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green hover:bg-green/80 text-white shadow-md transition-colors"
            title="Send voice note"
          >
            <SendIcon />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div
            className={clsx(
              "flex flex-1 items-end border border-gray-200 bg-light-bg px-1.5 py-1 dark:border-transparent dark:bg-[#242626] transition-[border-radius] duration-150",
              isMultiline ? "rounded-2xl" : "rounded-full",
            )}
          >
            {/* Emoji Button */}
            <IconButton ref={emojiButtonRef} onClick={onToggleEmojiPicker} title="Emoji">
              <EmojiIcon />
            </IconButton>

            {/* Text Input */}
            <div className="flex-1 bg-transparent relative my-auto">
              <div
                ref={backdropRef}
                className={clsx(
                  "absolute inset-0 w-full px-2 py-1.5 text-sm leading-5 whitespace-pre-wrap break-words pointer-events-none overflow-hidden",
                  "text-gray-900 dark:text-white",
                )}
                style={{
                  fontFamily: "inherit",
                  fontSize: "14px",
                  lineHeight: "20px",
                  wordBreak: "break-word",
                }}
                aria-hidden="true"
              >
                {renderHighlightedText()}
              </div>
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onScroll={handleScroll}
                placeholder="Message"
                className={clsx(
                  "relative z-10 w-full px-2 py-1.5 text-sm leading-5 bg-transparent resize-none outline-none overflow-y-auto",
                  "text-transparent caret-[#00a884] dark:caret-[#00a884]",
                  "placeholder:text-gray-500",
                )}
                style={{
                  fontFamily: "inherit",
                  fontSize: "14px",
                  lineHeight: "20px",
                  minHeight: "36px",
                  maxHeight: "140px",
                }}
                rows={1}
              />
              {/* Mention Suggestions */}
              {showSuggestions && (
                <div
                  ref={suggestionsRef}
                  className="absolute bottom-full left-0 right-0 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-40 overflow-y-auto"
                >
                  {mentionSuggestions.map(contact => {
                    const avatar = mentionAvatars[contact.phno]
                    const isLoading = loadingAvatars[contact.phno]
                    return (
                      <div
                        key={contact.phno}
                        onClick={() => handleSuggestionClick(contact)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2"
                      >
                        <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 overflow-hidden flex items-center justify-center shrink-0">
                          {isLoading ? (
                            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                          ) : avatar ? (
                            <img
                              src={avatar}
                              alt={contact.full_name || contact.push_name || contact.short}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <UserAvatar />
                          )}
                        </div>
                        <span>
                          {contact.full_name || contact.push_name || contact.short || contact.phno}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Attach Button + WhatsApp-style attach menu */}
            <div className="relative">
              <IconButton onClick={() => setAttachMenuOpen(v => !v)} title="Attach">
                <AttachIcon />
              </IconButton>
              {attachMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAttachMenuOpen(false)} />
                  <div className="absolute bottom-12 right-0 z-50 w-48 rounded-xl bg-white py-2 shadow-lg dark:bg-dark-secondary">
                    {(
                      [
                        {
                          label: "📷 Photos & videos",
                          act: () => {
                            setFileAccept("image/*,video/*")
                            setTimeout(() => fileInputRef.current?.click(), 0)
                          },
                        },
                        {
                          label: "📄 Document",
                          act: () => {
                            setFileAccept("*/*")
                            setTimeout(() => fileInputRef.current?.click(), 0)
                          },
                        },
                        { label: "📊 Poll", act: () => setPollOpen(true) },
                        { label: "👤 Contact", act: () => setContactOpen(true) },
                      ] as const
                    ).map(item => (
                      <button
                        key={item.label}
                        onClick={() => {
                          setAttachMenuOpen(false)
                          item.act()
                        }}
                        className="block w-full px-4 py-2 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-white/5"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Hidden File Input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={onFileSelect}
              className="hidden"
              accept={fileAccept}
            />
          </div>

          {/* Send Button or Mic Button */}
          {hasContent ? (
            <button
              onClick={onSendMessage}
              className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green hover:bg-green/80 text-white transition-colors shadow-sm"
              title="Send message"
            >
              <SendIcon />
            </button>
          ) : (
            <button
              onClick={startVoiceRecording}
              className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#242626] transition-colors"
              title="Record voice note"
            >
              <MicIcon />
            </button>
          )}
        </div>
      )}

      {pollOpen && <PollDialog chatId={chatId} onClose={() => setPollOpen(false)} />}
      {contactOpen && <ContactShareDialog chatId={chatId} onClose={() => setContactOpen(false)} />}
    </div>
  )
}
