import { create } from "zustand"
import { useContactStore } from "./useContactStore"
import { SetActiveChat } from "../../wailsjs/go/api/Api"

interface MessageStore {
  messages: Record<string, any[]>
  activeChatId: string | null
  setActiveChatId: (chatId: string) => void
  setMessages: (chatId: string, messages: any[]) => void
  addMessage: (chatId: string, message: any) => void
  prependMessages: (chatId: string, messages: any[]) => void
  updateMessage: (chatId: string, message: any) => void
  addReactionToMessage: (chatId: string, messageId: string, emoji: string, senderId: string) => void
  clearMessages: (chatId: string) => void
  trimOldMessages: (chatId: string, keepCount: number) => void
  addPendingMessage: (chatId: string, message: any) => void
  updatePendingMessageToSent: (chatId: string, tempId: string, message: any) => void
  updateDeliveryStatus: (chatId: string, messageIds: string[], status: string) => void
  deleteMessage: (chatId: string, messageId: string) => void
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  messages: {},
  activeChatId: null,

  setActiveChatId: chatId => {
    const prevChatId = get().activeChatId

    // Notify backend which chat is active (empty string means none)
    if (typeof SetActiveChat === "function") {
      SetActiveChat(chatId || "").catch(err => {
        console.error("Failed to sync active chat to backend:", err)
      })
    }

    set(state => {
      let updatedMessages = state.messages
      if (prevChatId && prevChatId !== chatId) {
        // keep only last 10 messages of previous chat (for quick switching)
        if (state.messages[prevChatId]) {
          updatedMessages = {
            ...state.messages,
            [prevChatId]: state.messages[prevChatId].slice(-10),
          }
        }

        // dispose contact name cache for old chat context
        useContactStore.getState().disposeCache()
      }
      return {
        messages: updatedMessages,
        activeChatId: chatId,
      }
    })
  },

  setMessages: (chatId, messages) =>
    set(state => ({
      messages: { ...state.messages, [chatId]: messages },
    })),

  addMessage: (chatId, message) =>
    set(state => ({
      messages: {
        ...state.messages,
        [chatId]: [...(state.messages[chatId] || []), message],
      },
    })),

  prependMessages: (chatId, messages) =>
    set(state => ({
      messages: {
        ...state.messages,
        [chatId]: [...messages, ...(state.messages[chatId] || [])],
      },
    })),

  updateMessage: (chatId, message) =>
    set(state => {
      const chatMsgs = state.messages[chatId] || []
      const idx = chatMsgs.findIndex(m => m.Info?.ID === message.Info?.ID)
      const updated =
        idx >= 0 ? chatMsgs.map((m, i) => (i === idx ? message : m)) : [...chatMsgs, message]
      return {
        messages: { ...state.messages, [chatId]: updated },
      }
    }),

  // Optimistically set/clear a sender's reaction on a message (empty emoji
  // removes it). One reaction per sender.
  addReactionToMessage: (chatId, messageId, emoji, senderId) =>
    set(state => {
      const msgs = state.messages[chatId]
      if (!msgs) return state
      const idx = msgs.findIndex((m: any) => m.Info?.ID === messageId)
      if (idx < 0) return state
      const msg = msgs[idx]
      // Dedupe by the phone-number part so an optimistic reaction replaces a
      // previously-synced one from the same person (which carries a full JID).
      const uid = (s: string) => (s || "").split("@")[0].split(":")[0]
      const target = uid(senderId)
      const others = (msg.reactions || []).filter((r: any) => uid(r.sender_id) !== target)
      const nextReactions = emoji
        ? [...others, { id: 0, message_id: messageId, sender_id: senderId, emoji }]
        : others
      const updatedMsg = { ...msg, reactions: nextReactions }
      const updatedList = msgs.map((m, i) => (i === idx ? updatedMsg : m))
      return {
        messages: { ...state.messages, [chatId]: updatedList },
      }
    }),

  trimOldMessages: (chatId, keepCount) =>
    set(state => {
      if (!state.messages[chatId] || state.messages[chatId].length <= keepCount) {
        return state
      }
      return {
        messages: {
          ...state.messages,
          [chatId]: state.messages[chatId].slice(-keepCount),
        },
      }
    }),

  clearMessages: chatId =>
    set(state => {
      const rest = { ...state.messages }
      delete rest[chatId]
      return { messages: rest }
    }),

  addPendingMessage: (chatId, message) =>
    set(state => ({
      messages: {
        ...state.messages,
        [chatId]: [...(state.messages[chatId] || []), message],
      },
    })),

  updatePendingMessageToSent: (chatId, tempId, message) =>
    set(state => {
      const chatMsgs = state.messages[chatId]
      if (!chatMsgs) return state

      const idx = chatMsgs.findIndex(m => m.tempId === tempId)
      let updated: any[]
      if (idx >= 0) {
        updated = chatMsgs.map((m, i) => (i === idx ? message : m))
      } else {
        // Fallback: If tempId not found, use updateMessage logic
        const existingIdx = chatMsgs.findIndex(m => m.Info?.ID === message.Info?.ID)
        if (existingIdx >= 0) {
          updated = chatMsgs.map((m, i) => (i === existingIdx ? message : m))
        } else {
          updated = [...chatMsgs, message]
        }
      }
      return {
        messages: { ...state.messages, [chatId]: updated },
      }
    }),

  updateDeliveryStatus: (chatId, messageIds, status) =>
    set(state => {
      const idSet = new Set(messageIds)
      const updateList = (msgs: any[]) =>
        msgs.map(msg => {
          if (idSet.has(msg.Info?.ID)) {
            const current = msg.delivery_status || (msg.isPending ? "pending" : "sent")
            if (current === "read") return msg
            if (current === "delivered" && status !== "read") return msg
            return { ...msg, delivery_status: status }
          }
          return msg
        })

      if (state.messages[chatId]) {
        return {
          messages: {
            ...state.messages,
            [chatId]: updateList(state.messages[chatId]),
          },
        }
      } else {
        const nextMessages: Record<string, any[]> = {}
        for (const [k, list] of Object.entries(state.messages)) {
          nextMessages[k] = updateList(list)
        }
        return { messages: nextMessages }
      }
    }),

  deleteMessage: (chatId, messageId) =>
    set(state => {
      if (!state.messages[chatId]) return state
      return {
        messages: {
          ...state.messages,
          [chatId]: state.messages[chatId].filter(
            (m: any) => m.Info?.ID !== messageId && m.tempId !== messageId,
          ),
        },
      }
    }),
}))
