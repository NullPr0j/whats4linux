import { GetMyJID } from "../../wailsjs/go/api/Api"

let myUser = ""

// The phone-number part of a JID, ignoring device and server suffixes.
export function userPart(jid: string): string {
  return (jid || "").split("@")[0].split(":")[0]
}

export async function initSelf(): Promise<string> {
  try {
    const raw = await GetMyJID()
    myUser = userPart(raw)
    return myUser
  } catch {
    /* not logged in yet */
    return ""
  }
}

export function getMyUser(): string {
  return myUser
}

// Whether a sender or chat JID is us ("me" is the optimistic local marker).
export function isMe(senderId: string): boolean {
  if (!senderId) return false
  if (senderId === "me") return true
  if (senderId.includes("@g.us")) return false
  if (!myUser) {
    void initSelf()
  }
  return !!myUser && userPart(senderId) === myUser
}

// Eager initialization on load
void initSelf()
