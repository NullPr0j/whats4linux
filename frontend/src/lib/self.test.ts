import { describe, it, expect, vi, beforeEach } from "vitest"
import { userPart, isMe, initSelf, getMyUser } from "./self"

vi.mock("../../wailsjs/go/api/Api", () => ({
  GetMyJID: vi.fn().mockResolvedValue("1234567890:1@s.whatsapp.net"),
}))

describe("self helper", () => {
  beforeEach(async () => {
    await initSelf()
  })

  it("extracts user part correctly", () => {
    expect(userPart("1234567890:1@s.whatsapp.net")).toBe("1234567890")
    expect(userPart("1234567890@s.whatsapp.net")).toBe("1234567890")
    expect(userPart("1234567890")).toBe("1234567890")
    expect(userPart("")).toBe("")
  })

  it("recognizes self", () => {
    expect(getMyUser()).toBe("1234567890")
    expect(isMe("me")).toBe(true)
    expect(isMe("1234567890:0@s.whatsapp.net")).toBe(true)
    expect(isMe("1234567890@s.whatsapp.net")).toBe(true)
    expect(isMe("1234567890")).toBe(true)
  })

  it("rejects non-self and groups", () => {
    expect(isMe("9876543210@s.whatsapp.net")).toBe(false)
    expect(isMe("1234567890-123456@g.us")).toBe(false)
    expect(isMe("")).toBe(false)
  })
})
