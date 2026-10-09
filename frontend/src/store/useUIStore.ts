import { create } from "zustand"

interface UIStore {
  sidebarOpen: boolean
  showEmojiPicker: boolean
  chatInfoOpen: boolean
  typingIndicators: Record<string, boolean>
  onlineStatus: Record<string, boolean>
  notifications: Array<{ id: number; message: string }>
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setShowEmojiPicker: (show: boolean) => void
  setChatInfoOpen: (open: boolean) => void
  setTypingIndicator: (chatId: string, isTyping: boolean) => void
  setOnlineStatus: (userId: string, isOnline: boolean) => void
  addNotification: (message: string, duration?: number) => number
  removeNotification: (id: number) => void
  lightboxSrc: string | null
  lightboxKind: "image" | "video"
  openLightbox: (src: string, kind?: "image" | "video") => void
  closeLightbox: () => void
  activePdf: { src: string; title: string; messageId: string } | null
  openPdf: (pdf: { src: string; title: string; messageId: string }) => void
  closePdf: () => void
  forwardingMessageId: string | null
  openForwardModal: (messageId: string) => void
  closeForwardModal: () => void
  profileModalJid: string | null
  openProfileModal: (jid: string) => void
  closeProfileModal: () => void
  pollResultsFor: string | null
  setPollResultsFor: (messageId: string | null) => void
}

export const useUIStore = create<UIStore>(set => ({
  sidebarOpen: true,
  showEmojiPicker: false,
  chatInfoOpen: false,
  typingIndicators: {},
  onlineStatus: {},
  notifications: [],

  lightboxSrc: null,
  lightboxKind: "image",
  openLightbox: (src, kind = "image") => set({ lightboxSrc: src, lightboxKind: kind }),
  closeLightbox: () => set({ lightboxSrc: null }),

  profileModalJid: null,
  openProfileModal: jid => set({ profileModalJid: jid }),
  closeProfileModal: () => set({ profileModalJid: null }),

  activePdf: null,
  openPdf: pdf => set({ activePdf: pdf }),
  closePdf: () => set({ activePdf: null }),

  forwardingMessageId: null,
  openForwardModal: messageId => set({ forwardingMessageId: messageId }),
  closeForwardModal: () => set({ forwardingMessageId: null }),

  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: open => set({ sidebarOpen: open }),
  setShowEmojiPicker: show => set({ showEmojiPicker: show }),
  setChatInfoOpen: open => set({ chatInfoOpen: open }),

  pollResultsFor: null,
  setPollResultsFor: messageId => set({ pollResultsFor: messageId }),

  setTypingIndicator: (chatId, isTyping) =>
    set(state => ({
      typingIndicators: { ...state.typingIndicators, [chatId]: isTyping },
    })),

  setOnlineStatus: (userId, isOnline) =>
    set(state => ({
      onlineStatus: { ...state.onlineStatus, [userId]: isOnline },
    })),

  addNotification: (message, duration = 3500) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    set(state => ({
      notifications: [...state.notifications, { id, message }],
    }))
    if (duration > 0) {
      setTimeout(() => {
        set(state => ({
          notifications: state.notifications.filter(n => n.id !== id),
        }))
      }, duration)
    }
    return id
  },

  removeNotification: id =>
    set(state => ({
      notifications: state.notifications.filter(n => n.id !== id),
    })),
}))
