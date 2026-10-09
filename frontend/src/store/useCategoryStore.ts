import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface ChatCategory {
  id: string
  name: string
  chatIds: string[]
}

interface CategoryState {
  categories: ChatCategory[]
  activeCategoryId: string // "all" | "unread" | "groups" | categoryId

  setActiveCategory: (id: string) => void
  createCategory: (name: string, chatIds?: string[]) => string
  updateCategory: (id: string, name: string, chatIds: string[]) => void
  deleteCategory: (id: string) => void
  toggleChatInCategory: (categoryId: string, chatId: string) => void
  addChatToCategory: (categoryId: string, chatId: string) => void
  removeChatFromCategory: (categoryId: string, chatId: string) => void
}

export const useCategoryStore = create<CategoryState>()(
  persist(
    (set, get) => ({
      categories: [
        // Default popular examples for quick start
        { id: "cat_favorites", name: "Favorites", chatIds: [] },
      ],
      activeCategoryId: "all",

      setActiveCategory: id => set({ activeCategoryId: id }),

      createCategory: (name, chatIds = []) => {
        const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        const newCat: ChatCategory = {
          id,
          name: name.trim(),
          chatIds: Array.from(new Set(chatIds)),
        }
        set(state => ({
          categories: [...state.categories, newCat],
          activeCategoryId: id,
        }))
        return id
      },

      updateCategory: (id, name, chatIds) => {
        set(state => ({
          categories: state.categories.map(cat =>
            cat.id === id
              ? {
                  ...cat,
                  name: name.trim() || cat.name,
                  chatIds: Array.from(new Set(chatIds)),
                }
              : cat,
          ),
        }))
      },

      deleteCategory: id => {
        set(state => ({
          categories: state.categories.filter(c => c.id !== id),
          activeCategoryId: state.activeCategoryId === id ? "all" : state.activeCategoryId,
        }))
      },

      toggleChatInCategory: (categoryId, chatId) => {
        set(state => ({
          categories: state.categories.map(cat => {
            if (cat.id !== categoryId) return cat
            const hasChat = cat.chatIds.includes(chatId)
            return {
              ...cat,
              chatIds: hasChat
                ? cat.chatIds.filter(id => id !== chatId)
                : [...cat.chatIds, chatId],
            }
          }),
        }))
      },

      addChatToCategory: (categoryId, chatId) => {
        set(state => ({
          categories: state.categories.map(cat => {
            if (cat.id !== categoryId) return cat
            if (cat.chatIds.includes(chatId)) return cat
            return {
              ...cat,
              chatIds: [...cat.chatIds, chatId],
            }
          }),
        }))
      },

      removeChatFromCategory: (categoryId, chatId) => {
        set(state => ({
          categories: state.categories.map(cat => {
            if (cat.id !== categoryId) return cat
            return {
              ...cat,
              chatIds: cat.chatIds.filter(id => id !== chatId),
            }
          }),
        }))
      },
    }),
    {
      name: "whats4linux-categories",
    },
  ),
)
