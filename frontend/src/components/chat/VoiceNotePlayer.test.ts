import { describe, it, expect } from "vitest"
import {
  generateWaveform,
  formatAudioTime,
  getNextPlaybackRate,
} from "./VoiceNotePlayer"

describe("VoiceNotePlayer logic and utilities", () => {
  it("formats audio duration and elapsed time correctly", () => {
    expect(formatAudioTime(0)).toBe("0:00")
    expect(formatAudioTime(5)).toBe("0:05")
    expect(formatAudioTime(45)).toBe("0:45")
    expect(formatAudioTime(65)).toBe("1:05")
    expect(formatAudioTime(135)).toBe("2:15")
  })

  it("cycles playback rate 1x -> 1.5x -> 2x -> 1x", () => {
    expect(getNextPlaybackRate(1.0)).toBe(1.5)
    expect(getNextPlaybackRate(1.5)).toBe(2.0)
    expect(getNextPlaybackRate(2.0)).toBe(1.0)
    expect(getNextPlaybackRate(3.0)).toBe(1.0)
  })

  it("generates deterministic waveform bars based on messageId", () => {
    const barsA1 = generateWaveform("msg-12345", 32)
    const barsA2 = generateWaveform("msg-12345", 32)
    const barsB = generateWaveform("msg-67890", 32)

    expect(barsA1).toHaveLength(32)
    expect(barsA1).toEqual(barsA2)
    expect(barsA1).not.toEqual(barsB)

    // All bars should be normalized between 0.15 and 1.0
    for (const height of barsA1) {
      expect(height).toBeGreaterThanOrEqual(0.15)
      expect(height).toBeLessThanOrEqual(1.0)
    }
  })
})
