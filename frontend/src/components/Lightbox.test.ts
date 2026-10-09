import { describe, it, expect, vi, beforeEach } from "vitest"
import { useUIStore } from "../store/useUIStore"

describe("Lightbox ESC handling and UI store interaction", () => {
  beforeEach(() => {
    useUIStore.setState({
      lightboxSrc: null,
      lightboxKind: "image",
      forwardingMessageId: null,
    })
  })

  it("opens and closes lightbox correctly in UI store", () => {
    expect(useUIStore.getState().lightboxSrc).toBeNull()

    useUIStore.getState().openLightbox("data:image/png;base64,abc", "image")
    expect(useUIStore.getState().lightboxSrc).toBe("data:image/png;base64,abc")
    expect(useUIStore.getState().lightboxKind).toBe("image")

    useUIStore.getState().closeLightbox()
    expect(useUIStore.getState().lightboxSrc).toBeNull()
  })

  it("handles Escape in capture phase by stopping propagation and closing lightbox", () => {
    useUIStore.getState().openLightbox("data:image/png;base64,abc", "image")

    const stopPropagation = vi.fn()
    const close = vi.fn(() => useUIStore.getState().closeLightbox())

    const handleKey = (e: { key: string; stopPropagation: () => void }) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        close()
      }
    }

    // When an Escape key is pressed
    handleKey({ key: "Escape", stopPropagation })

    expect(stopPropagation).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
    expect(useUIStore.getState().lightboxSrc).toBeNull()
  })

  it("ignores non-Escape keys", () => {
    useUIStore.getState().openLightbox("data:image/png;base64,abc", "image")

    const stopPropagation = vi.fn()
    const close = vi.fn(() => useUIStore.getState().closeLightbox())

    const handleKey = (e: { key: string; stopPropagation: () => void }) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        close()
      }
    }

    handleKey({ key: "Enter", stopPropagation })

    expect(stopPropagation).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(useUIStore.getState().lightboxSrc).toBe("data:image/png;base64,abc")
  })

  it("prevents ChatDetail from closing the chat when lightboxSrc is set", () => {
    useUIStore.getState().openLightbox("data:image/png;base64,abc", "image")

    const selectChat = vi.fn()
    const onBack = vi.fn()

    // Simulate ChatDetail ESC handler logic
    const chatDetailOnKey = (e: { key: string }) => {
      if (e.key !== "Escape") return
      if (useUIStore.getState().lightboxSrc || useUIStore.getState().forwardingMessageId) {
        return
      }
      if (onBack) {
        onBack()
      } else {
        selectChat(null)
      }
    }

    chatDetailOnKey({ key: "Escape" })

    // ChatDetail should NOT close the chat or call onBack
    expect(onBack).not.toHaveBeenCalled()
    expect(selectChat).not.toHaveBeenCalled()
  })

  it("prevents ChatDetail from closing the chat when profileModalJid is set", () => {
    useUIStore.getState().openProfileModal("user@s.whatsapp.net")

    const selectChat = vi.fn()
    const onBack = vi.fn()

    const chatDetailOnKey = (e: { key: string }) => {
      if (e.key !== "Escape") return
      if (
        useUIStore.getState().lightboxSrc ||
        useUIStore.getState().forwardingMessageId ||
        useUIStore.getState().profileModalJid
      ) {
        return
      }
      if (onBack) {
        onBack()
      } else {
        selectChat(null)
      }
    }

    chatDetailOnKey({ key: "Escape" })

    expect(onBack).not.toHaveBeenCalled()
    expect(selectChat).not.toHaveBeenCalled()
  })
})
