import { describe, it, expect, beforeEach } from "vitest"
import { useUIStore } from "./useUIStore"

describe("UIStore profile modal and lightbox state", () => {
  beforeEach(() => {
    useUIStore.setState({
      lightboxSrc: null,
      profileModalJid: null,
    })
  })

  it("handles opening and closing contact profile modal", () => {
    expect(useUIStore.getState().profileModalJid).toBeNull()

    useUIStore.getState().openProfileModal("123456789@s.whatsapp.net")
    expect(useUIStore.getState().profileModalJid).toBe("123456789@s.whatsapp.net")

    useUIStore.getState().closeProfileModal()
    expect(useUIStore.getState().profileModalJid).toBeNull()
  })

  it("opens avatar directly in lightbox", () => {
    useUIStore.getState().openLightbox("data:image/jpeg;base64,abc", "image")
    expect(useUIStore.getState().lightboxSrc).toBe("data:image/jpeg;base64,abc")
    expect(useUIStore.getState().lightboxKind).toBe("image")
  })
})
