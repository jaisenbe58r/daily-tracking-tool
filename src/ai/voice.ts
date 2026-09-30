/**
 * Dictation with the browser's own speech recognition (Chrome, Edge, Safari):
 * no audio leaves through our runtime and nothing loads until it's used.
 * Where the browser has none, the mic simply isn't offered.
 */

interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start(): void
  stop(): void
}
type RecognitionCtor = new () => Recognition

const Ctor = (): RecognitionCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export interface Dictation {
  stop(): void
}

export const dictation = {
  supported: () => Boolean(Ctor()),

  /** Starts listening; `onText` gets the whole phrase so far, interim words included. Null if unavailable. */
  start({ onText, onEnd }: { onText: (text: string) => void; onEnd: () => void }): Dictation | null {
    const Recognizer = Ctor()
    if (!Recognizer) return null
    const rec = new Recognizer()
    rec.lang = document.documentElement.lang || 'es-ES'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e) => {
      const heard = Array.from(e.results, (r) => r[0]?.transcript ?? '').join('').trim()
      if (heard) onText(heard)
    }
    rec.onend = onEnd
    rec.onerror = onEnd
    try {
      rec.start()
    } catch {
      return null
    }
    return { stop: () => rec.stop() }
  },
}
