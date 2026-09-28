import { dateKey } from './parse'
import { sanitize } from './persist'
import type { Task } from './types'
import { sanitizeTemplates, type Template } from './templates'

/** Saves every task as a JSON file the user keeps (Cmd/Ctrl+S). */
export function exportTasks(tasks: Task[], templates: Template[]): string {
  const name = `daily-tracking-${dateKey(new Date())}.json`
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tasks, templates }, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return name
}

/** Reads an exported file (or a bare array of tasks). Throws when nothing usable is inside. */
export async function readBackup(file: File): Promise<{ tasks: Task[]; templates: Template[] }> {
  const json = JSON.parse(await file.text())
  const tasks = sanitize(Array.isArray(json) ? json : json?.tasks)
  if (!tasks.length) throw new Error('empty')
  return { tasks, templates: sanitizeTemplates(json?.templates) }
}
