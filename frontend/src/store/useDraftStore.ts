import { create } from "zustand"

const STORAGE_KEY = "whats4linux_chat_drafts"

export function loadDraftsFromStorage(): Record<string, string> {
  try {
    if (typeof window === "undefined" || !window.localStorage) return {}
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveDraftsToStorage(drafts: Record<string, string>): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
  } catch {}
}

export interface DraftStore {
  drafts: Record<string, string>
  setDraft: (chatId: string, text: string) => void
  clearDraft: (chatId: string) => void
  getDraft: (chatId: string) => string
}

export const useDraftStore = create<DraftStore>((set, get) => ({
  drafts: loadDraftsFromStorage(),

  setDraft: (chatId: string, text: string) => {
    if (!chatId) return
    set(state => {
      const next = { ...state.drafts }
      if (!text || !text.trim()) {
        if (!(chatId in next)) return state
        delete next[chatId]
      } else {
        if (next[chatId] === text) return state
        next[chatId] = text
      }
      saveDraftsToStorage(next)
      return { drafts: next }
    })
  },

  clearDraft: (chatId: string) => {
    if (!chatId) return
    set(state => {
      if (!(chatId in state.drafts)) return state
      const next = { ...state.drafts }
      delete next[chatId]
      saveDraftsToStorage(next)
      return { drafts: next }
    })
  },

  getDraft: (chatId: string) => {
    return get().drafts[chatId] || ""
  },
}))
