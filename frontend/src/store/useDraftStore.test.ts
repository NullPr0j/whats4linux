import { describe, it, expect, beforeEach } from "vitest"
import { useDraftStore } from "./useDraftStore"

describe("useDraftStore", () => {
  beforeEach(() => {
    // Clear drafts before each test
    const { drafts, clearDraft } = useDraftStore.getState()
    Object.keys(drafts).forEach(k => clearDraft(k))
  })

  it("sets and gets draft for a chat", () => {
    const { setDraft, getDraft } = useDraftStore.getState()
    setDraft("chat-1", "Hello draft")
    expect(useDraftStore.getState().drafts["chat-1"]).toBe("Hello draft")
    expect(getDraft("chat-1")).toBe("Hello draft")
  })

  it("clears draft when text is empty or whitespace", () => {
    const { setDraft } = useDraftStore.getState()
    setDraft("chat-1", "Some text")
    expect(useDraftStore.getState().drafts["chat-1"]).toBe("Some text")

    setDraft("chat-1", "   ")
    expect(useDraftStore.getState().drafts["chat-1"]).toBeUndefined()
  })

  it("explicitly clears draft", () => {
    const { setDraft, clearDraft } = useDraftStore.getState()
    setDraft("chat-2", "Another draft")
    expect(useDraftStore.getState().drafts["chat-2"]).toBe("Another draft")

    clearDraft("chat-2")
    expect(useDraftStore.getState().drafts["chat-2"]).toBeUndefined()
  })
})
