import type { DiagramController } from './controller'
import { readDiagram } from './format'
import type { DiagramFile } from './types'
import { describeVersionError } from './versioning'

// Where a diagram comes from and goes to. The host supplies one of these; the controller never knows which: memory, the browser's
// storage, a database, a REST service. A diagram is kept as the versioned file (see format.ts) with the revision it was saved at.

export interface StoredDiagram {
  file: DiagramFile
  revision: number
}

export interface SaveMeta {
  // The revision this save is.
  revision: number
  // The revision the author last loaded or saved: null for a diagram that was never saved. A repository refuses the save when the stored
  // one is different, so a save never overwrites somebody else's work unseen.
  baseRevision: number | null
}

export interface DiagramRepository {
  // null when there is no diagram with that id.
  load(id: string): Promise<StoredDiagram | null>
  // Rejects with a RepositoryConflictError when baseRevision is not the stored revision.
  save(id: string, file: DiagramFile, meta: SaveMeta): Promise<void>
  // Optional: tells the host when someone else changes the diagram (a live or shared source). Returns how to stop.
  subscribe?(id: string, onRemoteChange: (stored: StoredDiagram) => void): () => void
}

export class RepositoryConflictError extends Error {
  readonly storedRevision: number | null
  constructor(id: string, storedRevision: number | null) {
    super(`“${id}” was changed somewhere else (it is at revision ${storedRevision ?? 'none'}). Load it again before saving.`)
    this.name = 'RepositoryConflictError'
    this.storedRevision = storedRevision
  }
}

const conflicts = (stored: number | null, base: number | null) => stored !== base

// ---- adapters ----

// Kept in memory: tests, demos, and hosts that save somewhere else themselves.
export function memoryRepository(initial: Record<string, StoredDiagram> = {}): DiagramRepository {
  const kept = new Map(Object.entries(initial).map(([id, stored]) => [id, structuredClone(stored)]))
  return {
    async load(id) {
      const stored = kept.get(id)
      return stored ? structuredClone(stored) : null
    },
    async save(id, file, meta) {
      const stored = kept.get(id)?.revision ?? null
      if (conflicts(stored, meta.baseRevision)) throw new RepositoryConflictError(id, stored)
      kept.set(id, structuredClone({ file, revision: meta.revision }))
    },
  }
}

// Kept in a Storage (the browser's localStorage, or anything shaped like it).
export function storageRepository(storage: Pick<Storage, 'getItem' | 'setItem'>, prefix = 'diagram:'): DiagramRepository {
  return {
    async load(id) {
      const raw = storage.getItem(prefix + id)
      if (raw === null) return null
      let parsed: { file?: unknown; revision?: unknown }
      try {
        parsed = JSON.parse(raw) as typeof parsed
      } catch {
        throw new Error(`The saved diagram “${id}” is damaged.`)
      }
      const read = readDiagram(parsed.file)
      if (!read.ok) throw new Error(`The saved diagram “${id}” could not be read: ${describeVersionError(read.error)}`)
      return { file: read.value, revision: typeof parsed.revision === 'number' ? parsed.revision : 0 }
    },
    async save(id, file, meta) {
      const raw = storage.getItem(prefix + id)
      let stored: number | null = null
      if (raw !== null) {
        try {
          const revision = (JSON.parse(raw) as { revision?: unknown }).revision
          stored = typeof revision === 'number' ? revision : 0
        } catch {
          stored = null
        }
      }
      if (conflicts(stored, meta.baseRevision)) throw new RepositoryConflictError(id, stored)
      storage.setItem(prefix + id, JSON.stringify({ file, revision: meta.revision }))
    },
  }
}

// Kept by a REST service: GET {base}/{id} answers 200 with {file, revision} or 404, and PUT {base}/{id} takes {file, revision, baseRevision} and
// answers 409 when baseRevision is not the stored one.
export function httpRepository(options: { baseUrl: string; fetch?: typeof fetch; headers?: Record<string, string> }): DiagramRepository {
  const call = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const url = (id: string) => `${options.baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(id)}`
  return {
    async load(id) {
      const response = await call(url(id), { headers: { accept: 'application/json', ...options.headers } })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Could not load “${id}” (${response.status}).`)
      const body = (await response.json()) as { file?: unknown; revision?: unknown }
      const read = readDiagram(body.file)
      if (!read.ok) throw new Error(`“${id}” could not be read: ${describeVersionError(read.error)}`)
      return { file: read.value, revision: typeof body.revision === 'number' ? body.revision : 0 }
    },
    async save(id, file, meta) {
      const response = await call(url(id), {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...options.headers },
        body: JSON.stringify({ file, revision: meta.revision, baseRevision: meta.baseRevision }),
      })
      if (response.status === 409) {
        const body = (await response.json().catch(() => ({}))) as { revision?: unknown }
        throw new RepositoryConflictError(id, typeof body.revision === 'number' ? body.revision : null)
      }
      if (!response.ok) throw new Error(`Could not save “${id}” (${response.status}).`)
    },
  }
}

// ---- binding a controller to a repository ----

export interface Binding {
  // Puts the stored diagram into the controller (false when there is none). Also what resumes saving after a conflict.
  load(): Promise<boolean>
  // Saves now if there is anything unsaved, and resolves when it is done: true when everything is saved (or there was nothing to save), false
  // when the save failed or met somebody else's change.
  flush(): Promise<boolean>
  dispose(): void
}

export interface BindOptions {
  id: string
  // How long after a change to wait before saving, so a burst of changes is one save.
  debounceMs?: number
  // A save or a load failed. Saving is tried again at the next change.
  onError?: (error: Error) => void
  // The stored diagram changed somewhere else. Saving stops until `load()` is called.
  onConflict?: (error: RepositoryConflictError) => void
}

// Loads a diagram into a controller and keeps it saved: each accepted change schedules a save (a burst is one), saves run one at a time,
// and a save that meets somebody else's change stops instead of overwriting it.
export function bindRepository(controller: DiagramController, repository: DiagramRepository, options: BindOptions): Binding {
  const { id, debounceMs = 300 } = options
  let baseRevision: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsaved = false
  let stopped = false
  let chain: Promise<unknown> = Promise.resolve()

  const save = (): Promise<boolean> => {
    const step = chain.then(async () => {
      if (stopped) return false
      if (!unsaved) return true
      unsaved = false
      const revision = controller.getSnapshot().revision
      try {
        await repository.save(id, controller.export(), { revision, baseRevision })
        baseRevision = revision
        return true
      } catch (error) {
        unsaved = true
        if (error instanceof RepositoryConflictError) {
          stopped = true
          options.onConflict?.(error)
        } else options.onError?.(error instanceof Error ? error : new Error(String(error)))
        return false
      }
    })
    chain = step
    return step
  }

  const schedule = () => {
    unsaved = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void save(), debounceMs)
  }

  const off = controller.onChange(schedule)
  const offRemote = repository.subscribe?.(id, (stored) => {
    controller.load(stored.file, stored.revision)
    baseRevision = stored.revision
    unsaved = false
  })

  return {
    async load() {
      try {
        const stored = await repository.load(id)
        if (!stored) {
          baseRevision = null
          stopped = false
          return false
        }
        controller.load(stored.file, stored.revision)
        baseRevision = stored.revision
        unsaved = false
        stopped = false
        return true
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)))
        return false
      }
    },
    async flush() {
      if (timer) clearTimeout(timer)
      timer = undefined
      return save()
    },
    dispose() {
      if (timer) clearTimeout(timer)
      off()
      offRemote?.()
    },
  }
}
