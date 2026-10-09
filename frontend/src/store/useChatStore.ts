import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { useCallback, useMemo } from "react"
import type { ChatItem } from "./types"
import { sortChatItems } from "../lib/chatSort"
import { useCategoryStore } from "./useCategoryStore"

interface ChatStore {
  // Use a Map for O(1) lookups and granular updates
  chatsById: Map<string, ChatItem>
  // Keep ordered list of chat IDs for rendering order
  chatIds: string[]
  selectedChatId: string | null
  selectedChatName: string
  selectedChatAvatar?: string
  selectedChatSender?: string
  searchTerm: string
  // Actions
  setChats: (chats: ChatItem[]) => void
  selectChat: (chat: ChatItem | null) => void
  setSearchTerm: (term: string) => void
  updateChatLastMessage: (
    chatId: string,
    message: string,
    timestamp?: number,
    sender?: string,
  ) => void
  updateSingleChat: (chatId: string, updates: Partial<ChatItem>) => void
  resortChats: () => void
  incrementUnreadCount: (chatId: string) => void
  clearUnreadCount: (chatId: string) => void
  addChat: (chat: ChatItem) => void
  getChat: (chatId: string) => ChatItem | undefined
}

export const useChatStore = create<ChatStore>((set, get) => ({
  chatsById: new Map(),
  chatIds: [],
  selectedChatId: null,
  selectedChatName: "",
  selectedChatAvatar: undefined,
  selectedChatSender: undefined,
  searchTerm: "",

  setChats: chats =>
    set(state => {
      const newChatsById = new Map<string, ChatItem>()

      for (const chat of chats) {
        // Preserve unread counts across a full refetch; the rebuilt items from
        // the backend don't carry unread state.
        const prev = state.chatsById.get(chat.id)
        newChatsById.set(
          chat.id,
          prev?.unreadCount ? { ...chat, unreadCount: prev.unreadCount } : chat,
        )
      }

      const newChatIds = sortChatItems([...newChatsById.values()]).map(c => c.id)
      return { chatsById: newChatsById, chatIds: newChatIds }
    }),

  selectChat: chat =>
    set({
      selectedChatId: chat?.id || null,
      selectedChatName: chat?.name || "",
      selectedChatAvatar: chat?.avatar,
      selectedChatSender: chat?.sender,
    }),

  setSearchTerm: term => set({ searchTerm: term }),

  // Recompute display order (pinned first, then recency) after an in-place
  // update like an optimistic pin toggle.
  resortChats: () =>
    set(state => ({
      chatIds: sortChatItems([...state.chatsById.values()]).map(c => c.id),
    })),

  // Update only a single chat without replacing the entire Map
  updateSingleChat: (chatId, updates) =>
    set(state => {
      const existingChat = state.chatsById.get(chatId)
      if (!existingChat) return state

      const newChatsById = new Map(state.chatsById)
      newChatsById.set(chatId, { ...existingChat, ...updates })

      return { chatsById: newChatsById }
    }),

  addChat: chat =>
    set(state => {
      const existing = state.chatsById.get(chat.id)
      const merged = existing ? { ...existing, ...chat } : chat
      const newChatsById = new Map(state.chatsById)
      newChatsById.set(chat.id, merged)
      const newChatIds = sortChatItems([...newChatsById.values()]).map(c => c.id)
      return { chatsById: newChatsById, chatIds: newChatIds }
    }),

  updateChatLastMessage: (chatId, message, timestamp, sender) =>
    set(state => {
      const existingChat = state.chatsById.get(chatId)
      const newChatsById = new Map(state.chatsById)

      if (existingChat) {
        newChatsById.set(chatId, {
          ...existingChat,
          subtitle: message,
          timestamp: timestamp || Date.now(),
          sender: sender !== undefined ? sender : existingChat.sender,
        })
      } else {
        newChatsById.set(chatId, {
          id: chatId,
          name: sender || chatId.split("@")[0].split(":")[0],
          subtitle: message,
          type: chatId.endsWith("@g.us") ? "group" : "contact",
          timestamp: timestamp || Date.now(),
          sender,
        })
      }

      // Re-sort: keeps pinned chats above even when another chat gets a
      // new message.
      const newChatIds = sortChatItems([...newChatsById.values()]).map(c => c.id)

      return { chatsById: newChatsById, chatIds: newChatIds }
    }),

  incrementUnreadCount: chatId =>
    set(state => {
      const existingChat = state.chatsById.get(chatId)
      if (!existingChat) return state

      const newChatsById = new Map(state.chatsById)
      newChatsById.set(chatId, {
        ...existingChat,
        unreadCount: (existingChat.unreadCount || 0) + 1,
      })

      return { chatsById: newChatsById }
    }),

  clearUnreadCount: chatId =>
    set(state => {
      const existingChat = state.chatsById.get(chatId)
      if (!existingChat) return state

      const newChatsById = new Map(state.chatsById)
      newChatsById.set(chatId, { ...existingChat, unreadCount: 0 })

      return { chatsById: newChatsById }
    }),

  getChat: chatId => get().chatsById.get(chatId),
}))

// Selector hook to get a single chat by ID - only re-renders when that specific chat changes
export const useChatById = (chatId: string) => {
  return useChatStore(useCallback((state: ChatStore) => state.chatsById.get(chatId), [chatId]))
}

// Selector hook to get only chat IDs (for list rendering) - doesn't re-render on chat content changes
export const useChatIds = () => {
  return useChatStore(useShallow((state: ChatStore) => state.chatIds))
}

// Selector for filtered chat IDs based on search, archive view, and active category.
export const useFilteredChatIds = (showArchived = false) => {
  const activeCategoryId = useCategoryStore(state => state.activeCategoryId)
  const categories = useCategoryStore(state => state.categories)
  const activeCategory = useMemo(
    () => categories.find(c => c.id === activeCategoryId),
    [categories, activeCategoryId],
  )

  return useChatStore(
    useShallow((state: ChatStore) => {
      const { chatIds, chatsById, searchTerm } = state
      const term = searchTerm.toLowerCase()

      return chatIds.filter(id => {
        const chat = chatsById.get(id)
        if (!chat) return false
        if (!!chat.archived !== showArchived) return false
        if (term && !chat.name.toLowerCase().includes(term)) return false

        if (showArchived) return true

        if (activeCategoryId === "all") return true
        if (activeCategoryId === "unread") return (chat.unreadCount ?? 0) > 0
        if (activeCategoryId === "groups") return chat.type === "group" || id.endsWith("@g.us")
        if (activeCategory) {
          return activeCategory.chatIds.includes(id)
        }
        return true
      })
    }),
  )
}

// Number of archived chats, for the "Archived" entry row.
export const useArchivedCount = () => {
  return useChatStore((state: ChatStore) => {
    let n = 0
    for (const chat of state.chatsById.values()) if (chat.archived) n++
    return n
  })
}

// Legacy helper to get chats as array (for backward compatibility)
export const useChatsArray = () => {
  return useChatStore(
    useShallow((state: ChatStore) => {
      return state.chatIds.map(id => state.chatsById.get(id)!).filter(Boolean)
    }),
  )
}
