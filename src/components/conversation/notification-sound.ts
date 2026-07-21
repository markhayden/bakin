/**
 * Reply chime — a soft two-tone WebAudio blip shared by every
 * conversational surface's attention provider (moved from the chat plugin
 * in #703; chat re-exports from here). Generated, not an asset: zero
 * bundle weight, no file to embed, and the volume stays deliberately low
 * (this is a nudge, not an alarm).
 */

let audioCtx: AudioContext | null = null

export function playReplyChime(): void {
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    audioCtx ??= new Ctor()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})

    const now = ctx.currentTime
    for (const [offset, freq] of [
      [0, 740], // F#5
      [0.09, 988], // B5
    ] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + offset)
      gain.gain.linearRampToValueAtTime(0.06, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.25)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.3)
    }
  } catch {
    // Audio is a nicety — never let it throw into the provider.
  }
}
