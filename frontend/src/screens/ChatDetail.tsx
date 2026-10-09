import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import {
  SendMessage,
  FetchMessagesPaged,
  GetPinnedMessages,
  SendChatPresence,
  GetGroupInfo,
  GetProfile,
  MarkRead,
  EditMessage,
  DeleteMessage,
} from "../../wailsjs/go/api/Api"
import { store } from "../../wailsjs/go/models"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { useMessageStore, useUIStore, useChatStore, useCallStore, useDraftStore } from "../store"
import { useAppSettingsStore } from "../store/useAppSettingsStore"
import { MessageList, type MessageListHandle } from "../components/chat/MessageList"
import { ChatHeader } from "../components/chat/ChatHeader"
import { ChatInput } from "../components/chat/ChatInput"
import { ChatInfo } from "../components/chat/ChatInfo"
import { PdfPreviewPane } from "../components/chat/PdfPreviewPane"
import { DeleteMessageModal } from "../components/chat/DeleteMessageModal"
import clsx from "clsx"
import { formatPhone, isMessageEditable } from "../lib/utils"
import { useSelfAvatarStore } from "../store/useSelfAvatarStore"
import { isMe } from "../lib/self"
import { AttachIcon } from "../assets/svgs/chat_icons"

interface ChatDetailProps {
  chatId: string
  chatName: string
  chatAvatar?: string
  onBack?: () => void
}

const PAGE_SIZE = 50
// Virtuoso needs a stable, large starting index so it can decrement as older
// messages are prepended, keeping the scroll position anchored.
const START_INDEX = 1_000_000

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function ChatDetail({ chatId, chatName, chatAvatar, onBack }: ChatDetailProps) {
  const {
    messages,
    setMessages,
    updateMessage,
    prependMessages,
    setActiveChatId,
    addPendingMessage,
    updatePendingMessageToSent,
  } = useMessageStore()
  const {
    setTypingIndicator,
    showEmojiPicker,
    setShowEmojiPicker,
    chatInfoOpen,
    setChatInfoOpen,
    activePdf,
    closePdf,
  } = useUIStore()
  const { chatsById } = useChatStore()
  const startCall = useCallStore(s => s.startCall)
  const isGroup = chatId.endsWith("@g.us")

  const chatMessages = messages[chatId] || []
  const [inputText, setInputText] = useState(() => useDraftStore.getState().getDraft(chatId))
  const [pastedImage, setPastedImage] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedFileType, setSelectedFileType] = useState<string>("")
  const [replyingTo, setReplyingTo] = useState<store.DecodedMessage | null>(null)
  const [editingMessage, setEditingMessage] = useState<store.DecodedMessage | null>(null)
  const [deleteTargetMessage, setDeleteTargetMessage] = useState<store.DecodedMessage | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounterRef = useRef(0)

  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null)

  const [mentionableContacts, setMentionableContacts] = useState<any[]>([])
  const [selectedMentions, setSelectedMentions] = useState<any[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)
  const [isReady, setIsReady] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX)

  const messageListRef = useRef<MessageListHandle>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const sentMediaCache = useRef<Map<string, string>>(new Map())
  const isComposingRef = useRef(false)
  const requestGenerationRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  const loadMorePromiseRef = useRef<Promise<store.DecodedMessage[]> | null>(null)
  const initialLoadPromiseRef = useRef<Promise<void> | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const focusComposer = useCallback(() => {
    const focus = () => {
      const el = textareaRef.current
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
    setTimeout(focus, 0)
    setTimeout(focus, 50)
    setTimeout(focus, 180)
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null)
    setInputText("")
    focusComposer()
  }, [focusComposer])

  const currentChat = chatsById.get(chatId)
  const chatType = currentChat?.type || "contact"
  const selfAvatar = useSelfAvatarStore(s => s.selfAvatar)
  const isSelf = isMe(chatId)
  const effectiveChatName = isSelf ? "You" : chatName
  const effectiveChatAvatar = isSelf ? (selfAvatar || chatAvatar) : chatAvatar

  const [chatSubtitle, setChatSubtitle] = useState("")
  const [pinnedMessages, setPinnedMessages] = useState<store.PinnedMessage[]>([])
  // Which pinned message the banner jumps to next (cycles like WhatsApp).
  const pinnedCycleRef = useRef(0)

  const loadPinned = useCallback(async () => {
    try {
      const pins = await GetPinnedMessages(chatId)
      setPinnedMessages(pins || [])
    } catch (err) {
      console.error("Failed to load pinned messages:", err)
      setPinnedMessages([])
    }
  }, [chatId])

  useEffect(() => {
    pinnedCycleRef.current = 0
    loadPinned()
    const unsub = EventsOn("wa:pinned_update", (data: { chatId: string }) => {
      if (data?.chatId === chatId) loadPinned()
    })
    return unsub
  }, [chatId, loadPinned])

  const pinnedIds = useMemo(() => new Set(pinnedMessages.map(p => p.message_id)), [pinnedMessages])

  useEffect(() => {
    if (isSelf) {
      setChatSubtitle("Message yourself")
      setMentionableContacts([])
      return
    }
    setChatSubtitle("")
    const loadMentionableContacts = async () => {
      if (chatType === "group") {
        try {
          const groupInfo = await GetGroupInfo(chatId)

          // WhatsApp-style participants line under the group name:
          // "You, Alice, ~ Bob, +91 98765 43210, …"
          const participantLabel = (c: any) =>
            c.full_name ||
            (c.push_name ? `~ ${c.push_name}` : "") ||
            c.short ||
            (c.phno ? formatPhone(c.phno) : "")
          try {
            const self = await GetProfile("")
            const others = groupInfo.group_participants
              .map((p: any) => p.contact)
              .filter((c: any) => c && c.phno !== self.phno && c.jid !== self.jid)
            setChatSubtitle(["You", ...others.map(participantLabel).filter(Boolean)].join(", "))
            setMentionableContacts(others)
          } catch (err) {
            const contacts = groupInfo.group_participants.map((p: any) => p.contact)
            setChatSubtitle(contacts.map(participantLabel).filter(Boolean).join(", "))
            setMentionableContacts(contacts)
          }
        } catch (error) {
          console.error("Failed to fetch group info:", error)
          setMentionableContacts([])
        }
      } else {
        setMentionableContacts([])
      }
    }
    loadMentionableContacts()
  }, [chatId, chatType])

  const scrollToBottom = useCallback((instant = false) => {
    requestAnimationFrame(() => {
      messageListRef.current?.scrollToBottom(instant ? "auto" : "smooth")
    })
  }, [])

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom)
  }, [])

  // Focus the composer as soon as a chat is opened so the user can type
  // immediately (like WhatsApp).
  useEffect(() => {
    textareaRef.current?.focus()
  }, [chatId])

  useEffect(() => {
    closePdf()
  }, [chatId, closePdf])

  // ESC: close overlays first (lightbox, PDF, delete dialog, info panel, emoji picker, edit, reply), then leave
  // the chat back to the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (
        useUIStore.getState().lightboxSrc ||
        useUIStore.getState().forwardingMessageId ||
        useUIStore.getState().profileModalJid
      ) {
        return
      }
      if (activePdf) {
        closePdf()
        return
      }
      if (deleteTargetMessage) {
        setDeleteTargetMessage(null)
        return
      }
      if (chatInfoOpen) {
        setChatInfoOpen(false)
        return
      }
      if (showEmojiPicker) {
        setShowEmojiPicker(false)
        return
      }
      if (editingMessage) {
        handleCancelEdit()
        return
      }
      if (replyingTo) {
        setReplyingTo(null)
        return
      }
      if (onBack) {
        onBack()
      } else {
        useChatStore.getState().selectChat(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activePdf, closePdf, deleteTargetMessage, chatInfoOpen, showEmojiPicker, editingMessage, handleCancelEdit, replyingTo, onBack, setChatInfoOpen, setShowEmojiPicker])

  const loadInitialMessages = useCallback(
    async (generation: number) => {
      setInitialLoad(true)
      setIsReady(false)
      const beforeRequest = new Map(
        (useMessageStore.getState().messages[chatId] || []).map(message => [
          message.Info?.ID,
          message,
        ]),
      )
      try {
        const msgs = await FetchMessagesPaged(chatId, PAGE_SIZE, 0, "")
        if (requestGenerationRef.current !== generation) return
        const loadedMsgs = msgs || []

        // Do not let the initial database snapshot overwrite an optimistic or
        // live message that arrived while the request was in flight.
        const current = useMessageStore.getState().messages[chatId] || []
        const currentByID = new Map(current.map(message => [message.Info?.ID, message]))
        const loadedIDs = new Set(loadedMsgs.map(message => message.Info?.ID))
        const merged = loadedMsgs.map(message => {
          const currentMessage = currentByID.get(message.Info?.ID)
          return currentMessage && currentMessage !== beforeRequest.get(message.Info?.ID)
            ? currentMessage
            : message
        })
        for (const message of current) {
          const id = message.Info?.ID
          if (id && !loadedIDs.has(id) && (!beforeRequest.has(id) || message.isPending)) {
            merged.push(message)
          }
        }
        setMessages(chatId, merged)
        const more = loadedMsgs.length >= PAGE_SIZE
        hasMoreRef.current = more
        setHasMore(more)

        requestAnimationFrame(() => {
          if (requestGenerationRef.current !== generation) return
          setIsReady(true)
          setInitialLoad(false)
        })
      } catch (err) {
        if (requestGenerationRef.current !== generation) return
        console.error("Initial load failed:", err)
        setInitialLoad(false)
      }
    },
    [chatId, setMessages],
  )

  const loadMoreMessages = useCallback((): Promise<store.DecodedMessage[]> => {
    if (loadMorePromiseRef.current) return loadMorePromiseRef.current
    if (!hasMoreRef.current || loadingMoreRef.current) return Promise.resolve([])

    const currentMessages = useMessageStore.getState().messages[chatId] || []
    if (currentMessages.length === 0) return Promise.resolve([])

    const generation = requestGenerationRef.current
    const oldestMessage = currentMessages[0]
    const beforeTimestamp = Math.floor(new Date(oldestMessage.Info.Timestamp).getTime() / 1000)
    loadingMoreRef.current = true
    setIsLoadingMore(true)

    const request = (async () => {
      try {
        const msgs =
          (await FetchMessagesPaged(chatId, PAGE_SIZE, beforeTimestamp, oldestMessage.Info.ID)) ||
          []
        if (requestGenerationRef.current !== generation) return []

        if (msgs.length > 0) {
          // Keep firstItemIndex and the prepended data in the same request
          // generation; a response from an abandoned chat cannot move this list.
          setFirstItemIndex(prev => prev - msgs.length)
          prependMessages(chatId, msgs)
        }
        const more = msgs.length >= PAGE_SIZE
        hasMoreRef.current = more
        setHasMore(more)
        return msgs
      } catch (err) {
        if (requestGenerationRef.current === generation) {
          console.error("Load more failed:", err)
        }
        return []
      }
    })()

    loadMorePromiseRef.current = request
    void request.finally(() => {
      if (loadMorePromiseRef.current === request) loadMorePromiseRef.current = null
      if (requestGenerationRef.current === generation) {
        loadingMoreRef.current = false
        setIsLoadingMore(false)
      }
    })
    return request
  }, [chatId, prependMessages])

  const handleQuotedClick = useCallback(
    async (messageId: string) => {
      const generation = requestGenerationRef.current
      if (initialLoadPromiseRef.current) await initialLoadPromiseRef.current
      if (requestGenerationRef.current !== generation) return
      let found = useMessageStore
        .getState()
        .messages[chatId]?.some(message => message.Info?.ID === messageId)

      // Pins and replies can point beyond the initial page. Load contiguous
      // older pages until the target is present or history is exhausted.
      while (!found && hasMoreRef.current && requestGenerationRef.current === generation) {
        const page = await loadMoreMessages()
        if (requestGenerationRef.current !== generation || page.length === 0) return
        found = page.some(message => message.Info?.ID === messageId)
      }
      if (!found || requestGenerationRef.current !== generation) return

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (requestGenerationRef.current !== generation) return
          if (!messageListRef.current?.scrollToMessage(messageId)) return
          setHighlightedMessageId(messageId)
          if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
          highlightTimerRef.current = setTimeout(() => {
            setHighlightedMessageId(null)
            highlightTimerRef.current = null
          }, 500)
        })
      })
    },
    [chatId, loadMoreMessages],
  )

  useEffect(() => {
    if (isAtBottom) {
      const messageIds = chatMessages.map((m: any) => m?.Info?.ID).filter((id: any) => !!id)
      if (messageIds.length > 0) {
        MarkRead(chatId, messageIds, "read-msg").catch(err => {
          console.error("Failed to mark messages as read:", err)
        })
      }
    }
  }, [isAtBottom, chatId, chatMessages])

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setInputText(newValue)
    useDraftStore.getState().setDraft(chatId, newValue)
    if (selectedMentions.length > 0) {
      setSelectedMentions(prev =>
        prev.filter(mention => {
          let name = mention.full_name
          if (!name) {
            if (mention.push_name) {
              name = `~ ${mention.push_name}`
            } else {
              name = mention.short || mention.phno
            }
          }
          return newValue.includes(`@${name}`)
        }),
      )
    }

    if (!isComposingRef.current) {
      isComposingRef.current = true
      setTypingIndicator(chatId, true)
      SendChatPresence(chatId, "composing", "").catch(() => {})
    }

    if (typingTimeout) clearTimeout(typingTimeout)
    const timeout = setTimeout(() => {
      isComposingRef.current = false
      SendChatPresence(chatId, "paused", "").catch(() => {})
      setTypingIndicator(chatId, false)
    }, 1500)
    setTypingTimeout(timeout)
  }

  const handleEdit = useCallback(
    (msg: store.DecodedMessage) => {
      if (!isMessageEditable(msg)) return
      setEditingMessage(msg)
      setReplyingTo(null)
      const raw = msg.Content?.conversation || msg.Content?.extendedTextMessage?.text || ""
      const plain = raw
        .replace(/<br\s*[\/]?>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
      setInputText(plain)
      focusComposer()
    },
    [focusComposer],
  )

  const handleReply = useCallback(
    (msg: store.DecodedMessage) => {
      setReplyingTo(msg)
      setEditingMessage(null)
      focusComposer()
    },
    [focusComposer],
  )

  useEffect(() => {
    if (replyingTo || editingMessage) {
      focusComposer()
    }
  }, [replyingTo, editingMessage, focusComposer])


  const editMostRecentMessage = useCallback(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const msg = chatMessages[i]
      if (isMessageEditable(msg)) {
        handleEdit(msg)
        return
      }
    }
  }, [chatMessages, handleEdit])

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      const isOtherInput =
        activeEl &&
        activeEl !== textareaRef.current &&
        (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")
      if (isOtherInput) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        editMostRecentMessage()
        return
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r") {
        e.preventDefault()
        if (chatMessages.length > 0) {
          handleReply(chatMessages[chatMessages.length - 1])
        }
        return
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown)
    return () => window.removeEventListener("keydown", handleGlobalKeyDown)
  }, [editMostRecentMessage, chatMessages, handleReply])

  const handleDelete = useCallback((msg: store.DecodedMessage) => {
    setDeleteTargetMessage(msg)
  }, [])

  const handleConfirmDelete = async (forEveryone: boolean) => {
    if (!deleteTargetMessage) return
    const msgId = deleteTargetMessage.Info.ID
    setDeleteTargetMessage(null)
    try {
      if (!forEveryone) {
        useMessageStore.getState().deleteMessage(chatId, msgId)
      }
      await DeleteMessage(chatId, msgId, forEveryone)
    } catch (err) {
      console.error("Failed to delete message:", err)
    }
  }

  const handleSendMessage = async () => {
    if (editingMessage) {
      const newText = inputText.trim()
      const targetId = editingMessage.Info.ID
      handleCancelEdit()
      if (!newText) {
        // Editing message to empty invokes delete it for everyone
        DeleteMessage(chatId, targetId, true).catch(err => {
          console.error("Failed to delete message for everyone on empty edit:", err)
        })
        return
      }
      EditMessage(chatId, targetId, newText).catch(err => {
        console.error("Failed to edit message:", err)
      })
      return
    }

    if (!inputText.trim() && !pastedImage && !selectedFile) return

    const textToSend = inputText
    const imageToSend = pastedImage
    const fileToSend = selectedFile
    const fileTypeToSend = selectedFileType
    const quotedMessageId = replyingTo?.Info.ID

    // Generate a temporary ID for optimistic update
    const tempId = `temp-${Date.now()}-${Math.random()}`

    // Create pending message
    const pendingMessage: any = {
      tempId,
      isPending: true,
      delivery_status: "pending",
      Info: {
        ID: tempId,
        IsFromMe: true,
        Timestamp: new Date().toISOString(),
        PushName: "You",
        Sender: "",
      },
      Content: {},
    }

    // Set content based on message type
    if (imageToSend) {
      pendingMessage.Content = {
        imageMessage: {
          caption: textToSend || "",
          mimetype: "image/png",
          _tempImage: imageToSend,
        },
      }
    } else if (fileToSend) {
      if (fileTypeToSend === "image") {
        pendingMessage.Content = {
          imageMessage: {
            caption: textToSend || "",
            mimetype: fileToSend.type,
            _tempFile: fileToSend,
          },
        }
      } else if (fileTypeToSend === "video") {
        pendingMessage.Content = {
          videoMessage: {
            caption: textToSend || "",
            mimetype: fileToSend.type,
            _tempFile: fileToSend,
          },
        }
      } else if (fileTypeToSend === "audio") {
        pendingMessage.Content = {
          audioMessage: {
            mimetype: fileToSend.type,
            _tempFile: fileToSend,
          },
        }
      } else {
        pendingMessage.Content = {
          documentMessage: {
            caption: textToSend || "",
            fileName: fileToSend.name,
            mimetype: fileToSend.type,
          },
        }
      }
    } else {
      pendingMessage.Content = {
        conversation: textToSend,
      }
    }

    // Add quoted message if replying
    if (quotedMessageId && replyingTo) {
      const contextInfo = {
        quotedMessage: replyingTo.Content,
        participant: replyingTo.Info.Sender,
        stanzaId: replyingTo.Info.ID,
      }

      if (pendingMessage.Content.conversation) {
        pendingMessage.Content = {
          extendedTextMessage: {
            text: pendingMessage.Content.conversation,
            contextInfo,
          },
        }
        delete pendingMessage.Content.conversation
      } else if (pendingMessage.Content.imageMessage) {
        pendingMessage.Content.imageMessage.contextInfo = contextInfo
      } else if (pendingMessage.Content.videoMessage) {
        pendingMessage.Content.videoMessage.contextInfo = contextInfo
      } else if (pendingMessage.Content.audioMessage) {
        pendingMessage.Content.audioMessage.contextInfo = contextInfo
      } else if (pendingMessage.Content.documentMessage) {
        pendingMessage.Content.documentMessage.contextInfo = contextInfo
      }
    }

    // Add pending message to store immediately
    addPendingMessage(chatId, pendingMessage)

    // Clear input
    setInputText("")
    useDraftStore.getState().clearDraft(chatId)
    setPastedImage(null)
    setSelectedFile(null)
    setReplyingTo(null)
    setSelectedMentions([])

    // Virtuoso follows appended messages when already at the bottom. When the
    // sender is reading older history, explicitly take them to their new post.
    if (!isAtBottom) scrollToBottom(false)

    let processedText = textToSend
    const mentionsToSend: string[] = []
    if (selectedMentions.length > 0) {
      const sortedMentions = [...selectedMentions].sort((a, b) => {
        let nameA = a.full_name
        if (!nameA) nameA = a.push_name ? `~ ${a.push_name}` : a.short || a.phno

        let nameB = b.full_name
        if (!nameB) nameB = b.push_name ? `~ ${b.push_name}` : b.short || b.phno

        return nameB.length - nameA.length
      })

      for (const mention of sortedMentions) {
        let name = mention.full_name
        if (!name) {
          if (mention.push_name) {
            name = `~ ${mention.push_name}`
          } else {
            name = mention.short || mention.phno
          }
        }
        const mentionText = `@${name}`

        if (processedText.includes(mentionText)) {
          const userPart = mention.jid.split("@")[0]
          const replacement = `@${userPart}`

          processedText = processedText.replaceAll(mentionText, replacement)

          mentionsToSend.push(mention.jid)
        }
      }
    }

    try {
      if (imageToSend) {
        const base64 = imageToSend.split(",")[1]
        const mimetype = imageToSend.match(/^data:([^;,]+)/)?.[1] || "image/png"
        await SendMessage(chatId, {
          type: "image",
          clientTempId: tempId,
          base64Data: base64,
          mimetype,
          text: processedText,
          quotedMessageId,
          mentions: mentionsToSend,
        })
      } else if (fileToSend) {
        const dataURL = await blobToDataURL(fileToSend)
        const base64 = dataURL.split(",")[1]
        await SendMessage(chatId, {
          type: fileTypeToSend,
          clientTempId: tempId,
          base64Data: base64,
          mimetype: fileToSend.type || "application/octet-stream",
          fileName: fileToSend.name,
          text: processedText,
          quotedMessageId,
          mentions: mentionsToSend,
        })
      } else {
        await SendMessage(chatId, {
          type: "text",
          clientTempId: tempId,
          text: processedText,
          quotedMessageId,
          mentions: mentionsToSend,
        })
      }
    } catch (err) {
      console.error("Failed to send:", err)
      // Optionally, mark message as failed or remove it
    }
  }

  const handleSendVoiceNote = async (base64Data: string, mimetype: string, durationSeconds: number) => {
    const tempId = `temp-${Date.now()}-${Math.random()}`
    const quotedMessageId = replyingTo?.Info.ID

    const pendingMessage: any = {
      tempId,
      isPending: true,
      delivery_status: "pending",
      Info: {
        ID: tempId,
        IsFromMe: true,
        Timestamp: new Date().toISOString(),
        PushName: "You",
        Sender: "",
      },
      Content: {
        audioMessage: {
          mimetype,
          seconds: durationSeconds,
          ptt: true,
        },
      },
    }

    if (quotedMessageId && replyingTo) {
      pendingMessage.Content.audioMessage.contextInfo = {
        quotedMessage: replyingTo.Content,
        participant: replyingTo.Info.Sender,
        stanzaId: replyingTo.Info.ID,
      }
    }

    addPendingMessage(chatId, pendingMessage)
    setReplyingTo(null)
    if (!isAtBottom) scrollToBottom(false)

    try {
      await SendMessage(chatId, {
        type: "audio",
        clientTempId: tempId,
        base64Data,
        mimetype,
        quotedMessageId,
        ptt: true,
        seconds: durationSeconds,
      })
    } catch (err) {
      console.error("Failed to send voice note:", err)
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDraggingOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDraggingOver(false)

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    const file = files[0]
    const mime = file.type || ""

    if (mime.startsWith("image/")) {
      setSelectedFileType("image")
      const reader = new FileReader()
      reader.onload = ev => {
        setPastedImage(ev.target?.result as string)
      }
      reader.readAsDataURL(file)
    } else if (mime.startsWith("video/")) {
      setSelectedFileType("video")
      setSelectedFile(file)
    } else if (mime.startsWith("audio/")) {
      setSelectedFileType("audio")
      setSelectedFile(file)
    } else {
      setSelectedFileType("document")
      setSelectedFile(file)
    }

    focusComposer()
  }

  useEffect(() => {
    const generation = ++requestGenerationRef.current
    loadingMoreRef.current = false
    loadMorePromiseRef.current = null
    hasMoreRef.current = true
    setFirstItemIndex(START_INDEX)
    setHasMore(true)
    setIsLoadingMore(false)
    setIsAtBottom(true)
    setActiveChatId(chatId)
    setInputText(useDraftStore.getState().getDraft(chatId))
    setPastedImage(null)
    setSelectedFile(null)
    setSelectedFileType("")
    setReplyingTo(null)
    setEditingMessage(null)
    const initialRequest = loadInitialMessages(generation)
    initialLoadPromiseRef.current = initialRequest
    void initialRequest.finally(() => {
      if (initialLoadPromiseRef.current === initialRequest) initialLoadPromiseRef.current = null
    })
    return () => {
      setActiveChatId("")
      if (requestGenerationRef.current === generation) requestGenerationRef.current++
      loadingMoreRef.current = false
      loadMorePromiseRef.current = null
      initialLoadPromiseRef.current = null
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
    }
  }, [chatId, loadInitialMessages, setActiveChatId])

  useEffect(() => {
    // New messages from events still use the old Message format for real-time updates
    // They will be compatible due to the Info and Content structure
    const unsub = EventsOn(
      "wa:new_message",
      (data: { chatId: string; message: any; clientTempId?: string }) => {
        const isTargetChat =
          data?.chatId === chatId ||
          (Boolean(data?.chatId && chatId) &&
            data.chatId.split("@")[0].split(":")[0] === chatId.split("@")[0].split(":")[0])
        if (isTargetChat && data.message?.Info?.ID) {
          // Use getState to avoid depending on messages array and causing re-subscriptions
          const currentMessages = useMessageStore.getState().messages[chatId] || []
          const hasPendingMessage = currentMessages.some((m: any) => m.isPending)

          if (hasPendingMessage && data.message.Info?.IsFromMe && data.clientTempId) {
            const pendingMessages = currentMessages.filter((m: any) => m.isPending)
            const pending = pendingMessages.find((m: any) => m.tempId === data.clientTempId)
            if (pending) {
              for (const body of ["imageMessage", "videoMessage", "audioMessage"]) {
                const transient =
                  pending.Content?.[body]?._tempImage || pending.Content?.[body]?._tempFile
                if (transient && data.message.Content?.[body]) {
                  data.message.Content[body][
                    transient instanceof File ? "_tempFile" : "_tempImage"
                  ] = transient
                }
              }
              updatePendingMessageToSent(chatId, pending.tempId, data.message)
            } else {
              updateMessage(chatId, data.message)
            }
          } else {
            updateMessage(chatId, data.message)
          }
        }
      },
    )

    const unsubReceipt = EventsOn(
      "wa:message_receipt",
      (data: { chatId: string; messageIds: string[]; status: string }) => {
        if (data?.messageIds && data?.status) {
          useMessageStore.getState().updateDeliveryStatus(data.chatId, data.messageIds, data.status)
        }
      },
    )

    const unsubDeleted = EventsOn(
      "wa:message_deleted",
      (data: { chatId: string; messageId: string }) => {
        if (data?.messageId) {
          useMessageStore.getState().deleteMessage(data.chatId, data.messageId)
        }
      },
    )

    return () => {
      unsub()
      unsubReceipt()
      unsubDeleted()
    }
  }, [chatId, updateMessage, updatePendingMessageToSent])

  return (
    <div className="flex h-full min-w-0">
      <div
        className="flex flex-col flex-1 min-w-0 relative"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDraggingOver && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none transition-all">
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#00a884] bg-white/10 dark:bg-black/50 p-8 shadow-2xl">
              <div className="mb-3 rounded-full bg-[#00a884]/20 p-4 text-[#00a884]">
                <AttachIcon />
              </div>
              <p className="text-lg font-medium text-white">Drop files here</p>
              <p className="mt-1 text-sm text-gray-300">Add to message as attachment</p>
            </div>
          </div>
        )}
        <ChatHeader
          chatName={effectiveChatName}
          chatSubtitle={chatSubtitle}
          chatAvatar={effectiveChatAvatar}
          onBack={onBack}
          onInfoClick={() => setChatInfoOpen(!chatInfoOpen)}
          onCallClick={!isGroup && !isSelf ? () => startCall(chatId, effectiveChatName) : undefined}
        />

        {/* Pinned-messages banner: shows the latest pin, click cycles through
            pins newest-first and jumps to each message (WhatsApp behavior). */}
        {pinnedMessages.length > 0 && (
          <div
            onClick={() => {
              const idx = pinnedCycleRef.current % pinnedMessages.length
              const target = pinnedMessages[pinnedMessages.length - 1 - idx]
              pinnedCycleRef.current = idx + 1
              handleQuotedClick(target.message_id)
            }}
            className="flex items-center gap-2 border-b border-gray-200 bg-light-secondary px-4 py-2 text-sm cursor-pointer dark:border-white/5 dark:bg-dark-bg"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              className="shrink-0 fill-current text-[#1b9a58] dark:text-[#21c063]"
            >
              <path d="M16 3a1 1 0 0 1 .95 1.31l-.9 2.72 3.42 3.42a1 1 0 0 1-.21 1.57l-3.62 2.07-1.9 4.75a1 1 0 0 1-1.64.33L9 16.07l-4.29 4.3-1.42-1.42 4.3-4.29-3.1-3.1a1 1 0 0 1 .33-1.64l4.75-1.9 2.07-3.62A1 1 0 0 1 12.5 4z" />
            </svg>
            <span
              className="flex-1 truncate text-gray-700 dark:text-gray-200 [&_*]:inline"
              dangerouslySetInnerHTML={{
                __html: pinnedMessages[pinnedMessages.length - 1].text || "Pinned message",
              }}
            />
            {pinnedMessages.length > 1 && (
              <span className="shrink-0 text-xs text-gray-500 dark:text-[#8696a0]">
                {pinnedMessages.length}
              </span>
            )}
          </div>
        )}

        <div className="flex-1 relative overflow-hidden">
          {/* Static chat wallpaper: painted once behind the list instead of
              scrolling (and repainting) with it — big scroll-perf win. */}
          <div className="chat-wallpaper absolute inset-0 pointer-events-none z-0" />
          {(initialLoad || !isReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#efeae2] dark:bg-[#0a0a0a] z-50">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
            </div>
          )}

          {activePdf && (
            <div className="absolute inset-0 z-40 bg-white dark:bg-[#111b21]">
              <PdfPreviewPane pdf={activePdf} onClose={closePdf} />
            </div>
          )}

          <button
            onClick={() => scrollToBottom(false)}
            aria-label="Scroll to bottom"
            className={clsx(
              "absolute bottom-4 right-8 bg-white dark:bg-received-bubble-dark-bg p-2 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 z-100 hover:bg-gray-100 dark:hover:bg-[#2a3942] transition-opacity duration-300",
              isAtBottom ? "opacity-0 pointer-events-none" : "opacity-100"
            )}
          >
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              className="fill-current text-gray-600 dark:text-gray-400"
            >
              <path d="M12 16.17L4.83 9L3.41 10.41L12 19L20.59 10.41L19.17 9L12 16.17Z" />
            </svg>
          </button>

          <div className={clsx("relative z-10 h-full", (!isReady || initialLoad) && "invisible")}>
            <MessageList
              key={`${chatId}:${isReady ? "ready" : "loading"}`}
              ref={messageListRef}
              chatId={chatId}
              messages={chatMessages}
              firstItemIndex={firstItemIndex}
              sentMediaCache={sentMediaCache}
              onReply={handleReply}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onQuotedClick={handleQuotedClick}
              onLoadMore={() => void loadMoreMessages()}
              onAtBottomChange={handleAtBottomChange}
              pinnedIds={pinnedIds}
              isLoading={isLoadingMore}
              hasMore={isReady && hasMore}
              highlightedMessageId={highlightedMessageId}
            />
          </div>
        </div>
        <ChatInput
          chatId={chatId}
          inputText={inputText}
          pastedImage={pastedImage}
          selectedFile={selectedFile}
          selectedFileType={selectedFileType}
          showEmojiPicker={showEmojiPicker}
          textareaRef={textareaRef}
          fileInputRef={fileInputRef}
          emojiPickerRef={emojiPickerRef}
          emojiButtonRef={emojiButtonRef}
          replyingTo={replyingTo}
          editingMessage={editingMessage}
          mentionableContacts={mentionableContacts}
          onInputChange={handleInputChange}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSendMessage()
              return
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
              e.preventDefault()
              editMostRecentMessage()
              return
            }
            if (e.key === "ArrowUp" && !inputText && !editingMessage) {
              e.preventDefault()
              editMostRecentMessage()
              return
            }
            if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r") {
              e.preventDefault()
              if (chatMessages.length > 0) {
                handleReply(chatMessages[chatMessages.length - 1])
              }
              return
            }
            if (e.key === "Escape") {
              if (editingMessage) {
                e.preventDefault()
                e.stopPropagation()
                handleCancelEdit()
                return
              }
              if (replyingTo) {
                e.preventDefault()
                e.stopPropagation()
                setReplyingTo(null)
                focusComposer()
                return
              }
            }
          }}
          onPaste={async e => {
            // Chromium exposes pasted images synchronously via DataTransfer.
            const items = e.clipboardData?.items
            for (const item of items || []) {
              if (item.type.indexOf("image") !== -1) {
                const file = item.getAsFile()
                if (file) {
                  e.preventDefault()
                  setPastedImage(await blobToDataURL(file))
                  return
                }
              }
            }

            // WebKitGTK (Wails on Linux) does not put system-clipboard images
            // into DataTransfer, so fall back to the async Clipboard API.
            if (!navigator.clipboard?.read) return
            try {
              const clipboardItems = await navigator.clipboard.read()
              for (const clipboardItem of clipboardItems) {
                const imageType = clipboardItem.types.find(t => t.startsWith("image/"))
                if (imageType) {
                  const blob = await clipboardItem.getType(imageType)
                  setPastedImage(await blobToDataURL(blob))
                  return
                }
              }
            } catch (err) {
              console.error("Clipboard image read failed:", err)
            }
          }}
          onSendMessage={handleSendMessage}
          onFileSelect={e => {
            const file = e.target.files?.[0]
            if (file) {
              setSelectedFile(file)
              const generalType = file.type.split("/")[0]
              setSelectedFileType(
                generalType === "image" || generalType === "video" || generalType === "audio"
                  ? generalType
                  : "document",
              )
            }
          }}
          onRemoveFile={() => {
            setSelectedFile(null)
            setPastedImage(null)
          }}
          onEmojiClick={emoji => {
            setInputText(prev => {
              const next = prev + emoji
              useDraftStore.getState().setDraft(chatId, next)
              return next
            })
            setShowEmojiPicker(false)
          }}
          onToggleEmojiPicker={() => setShowEmojiPicker(!showEmojiPicker)}
          onCancelReply={() => {
            setReplyingTo(null)
            focusComposer()
          }}
          onCancelEdit={handleCancelEdit}
          onMentionAdd={contact => setSelectedMentions(prev => [...prev, contact])}
          selectedMentions={selectedMentions}
          onSendVoiceNote={handleSendVoiceNote}
        />
      </div>

      <ChatInfo
        chatId={chatId}
        chatName={effectiveChatName}
        chatType={chatType}
        chatAvatar={effectiveChatAvatar}
        isOpen={chatInfoOpen}
        onClose={() => setChatInfoOpen(false)}
      />

      <DeleteMessageModal
        isOpen={!!deleteTargetMessage}
        isFromMe={Boolean(
          deleteTargetMessage?.Info.IsFromMe ||
            (deleteTargetMessage?.Info.Sender && isMe(deleteTargetMessage.Info.Sender)) ||
            isMe(chatId),
        )}
        onClose={() => setDeleteTargetMessage(null)}
        onDeleteForEveryone={() => handleConfirmDelete(true)}
        onDeleteForMe={() => handleConfirmDelete(false)}
      />
    </div>
  )
}
