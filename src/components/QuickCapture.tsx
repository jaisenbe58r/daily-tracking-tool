import { useLayoutEffect, useRef, useState } from 'react'

interface Props {
  onCapture: (text: string) => void
  onClose: () => void
}

/**
 * Cmd/Ctrl+K from anywhere: one floating line, Enter saves, and focus goes back
 * to where it was. The capture grammar (#tag, !, mañana) applies here too.
 */
export function QuickCapture({ onCapture, onClose }: Props) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => inputRef.current?.focus(), [])

  return (
    <div className="qa-backdrop capture-backdrop" onPointerDown={onClose}>
      <div className="capture" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Capturar tarea">
        <span className="capture-check" aria-hidden />
        <input
          ref={inputRef}
          id="quick-capture"
          className="capture-input"
          value={text}
          placeholder="Apunta una tarea…   #tag   !   mañana"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              e.preventDefault()
              onCapture(text)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <kbd>↵</kbd>
      </div>
    </div>
  )
}
