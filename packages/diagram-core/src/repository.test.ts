import { describe, expect, it, vi } from 'vitest'
import { createDiagramController } from './controller'
import { bindRepository, httpRepository, memoryRepository, RepositoryConflictError, storageRepository } from './repository'
import type { StoredDiagram } from './repository'
import { defineRepositoryConformance } from './testing'
import type { DiagramFile } from './types'
import { DIAGRAM_SCHEMA_VERSION } from './format'

const file = (name: string): DiagramFile => ({ schemaVersion: DIAGRAM_SCHEMA_VERSION, name, groups: [], nodes: [{ id: 'a', title: 'A', x: 0, y: 0, w: 160, h: 80, body: '' }], edges: [] })

const memoryStorage = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}

// A small REST service, as a fetch: the other half of httpRepository.
function fakeService() {
  const kept = new Map<string, StoredDiagram>()
  const calls: string[] = []
  const handler = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const id = decodeURIComponent(String(input).split('/').pop() ?? '')
    calls.push(`${init?.method ?? 'GET'} ${id}`)
    if (!init?.method || init.method === 'GET') {
      const stored = kept.get(id)
      return stored ? Response.json(stored) : new Response(null, { status: 404 })
    }
    const body = JSON.parse(String(init.body)) as { file: DiagramFile; revision: number; baseRevision: number | null }
    const current = kept.get(id)?.revision ?? null
    if (current !== body.baseRevision) return Response.json({ revision: current }, { status: 409 })
    kept.set(id, { file: body.file, revision: body.revision })
    return new Response(null, { status: 204 })
  }) as typeof fetch
  return { handler, kept, calls }
}

defineRepositoryConformance('memory', () => memoryRepository())
defineRepositoryConformance('storage', () => storageRepository(memoryStorage()))
defineRepositoryConformance('http', () => httpRepository({ baseUrl: 'https://example.test/diagrams', fetch: fakeService().handler }))

describe('the storage repository', () => {
  it('upgrades an older file on the way in, and refuses one that is damaged or from a newer app', async () => {
    const storage = memoryStorage()
    const repository = storageRepository(storage)
    storage.data.set('diagram:old', JSON.stringify({ file: { schemaVersion: 1, name: 'Old', groups: [], nodes: [{ id: 'a', title: 'A', layer: 'ui', x: 0, y: 0, w: 160, h: 80, body: '' }], edges: [] }, revision: 3 }))
    const loaded = await repository.load('old')
    expect(loaded).toMatchObject({ revision: 3, file: { schemaVersion: DIAGRAM_SCHEMA_VERSION, nodes: [{ color: 'blue' }] } })
    storage.data.set('diagram:bad', '{nope')
    await expect(repository.load('bad')).rejects.toThrow(/damaged/)
    storage.data.set('diagram:new', JSON.stringify({ file: { ...file('N'), schemaVersion: 99 }, revision: 1 }))
    await expect(repository.load('new')).rejects.toThrow(/could not be read/)
  })
})

describe('the http repository', () => {
  it('asks for the id it was given, encoded, and turns 404 into nothing and 409 into a conflict', async () => {
    const service = fakeService()
    const repository = httpRepository({ baseUrl: 'https://example.test/diagrams/', fetch: service.handler })
    expect(await repository.load('a b')).toBeNull()
    await repository.save('a b', file('One'), { revision: 1, baseRevision: null })
    expect(service.calls).toEqual(['GET a b', 'PUT a b'])
    await expect(repository.save('a b', file('Two'), { revision: 2, baseRevision: null })).rejects.toBeInstanceOf(RepositoryConflictError)
  })

  it('says so when the service fails', async () => {
    const repository = httpRepository({ baseUrl: 'https://example.test', fetch: (async () => new Response('x', { status: 500 })) as typeof fetch })
    await expect(repository.load('a')).rejects.toThrow(/500/)
    await expect(repository.save('a', file('A'), { revision: 1, baseRevision: null })).rejects.toThrow(/500/)
  })
})

describe('keeping a controller saved', () => {
  const add = (c: ReturnType<typeof createDiagramController>, title: string) => c.apply({ ops: [{ op: 'createNode', node: { title, body: '' } }], summary: title, source: 'user' })

  it('loads what is stored, and says when there is nothing', async () => {
    const repository = memoryRepository({ d: { file: file('Stored'), revision: 5 } })
    const c = createDiagramController()
    const binding = bindRepository(c, repository, { id: 'd' })
    expect(await binding.load()).toBe(true)
    expect(c.getSnapshot()).toMatchObject({ name: 'Stored', revision: 5 })
    expect(await bindRepository(createDiagramController(), repository, { id: 'missing' }).load()).toBe(false)
    binding.dispose()
  })

  it('saves a burst of changes as one save, after the delay, and each later save builds on the last', async () => {
    vi.useFakeTimers()
    try {
      const repository = memoryStorage()
      const store = storageRepository(repository)
      const save = vi.spyOn(store, 'save')
      const c = createDiagramController()
      const binding = bindRepository(c, store, { id: 'd', debounceMs: 100 })
      add(c, 'A')
      add(c, 'B')
      add(c, 'C')
      expect(save).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(100)
      expect(save).toHaveBeenCalledTimes(1)
      expect(save.mock.calls[0][2]).toEqual({ revision: 3, baseRevision: null })
      add(c, 'D')
      await vi.advanceTimersByTimeAsync(100)
      expect(save.mock.calls[1][2]).toEqual({ revision: 4, baseRevision: 3 })
      expect((await store.load('d'))?.file.nodes).toHaveLength(4)
      binding.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes on request, and does not save what was loaded', async () => {
    const repository = memoryRepository({ d: { file: file('Stored'), revision: 1 } })
    const save = vi.spyOn(repository, 'save')
    const c = createDiagramController()
    const binding = bindRepository(c, repository, { id: 'd', debounceMs: 60_000 })
    await binding.load()
    expect(await binding.flush()).toBe(true)
    expect(save).not.toHaveBeenCalled()
    add(c, 'New')
    expect(await binding.flush()).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    binding.dispose()
  })

  it('stops, and says so, when somebody else saved in between, instead of overwriting; loading again resumes', async () => {
    const repository = memoryRepository({ d: { file: file('Stored'), revision: 1 } })
    const conflicts: Error[] = []
    const c = createDiagramController()
    const binding = bindRepository(c, repository, { id: 'd', debounceMs: 60_000, onConflict: (e) => conflicts.push(e) })
    await binding.load()
    await repository.save('d', file('Theirs'), { revision: 2, baseRevision: 1 })
    add(c, 'Mine')
    expect(await binding.flush()).toBe(false)
    expect(conflicts).toHaveLength(1)
    expect((await repository.load('d'))?.file.name).toBe('Theirs')
    // Nothing more is saved until the diagram is loaded again.
    add(c, 'More')
    await binding.flush()
    expect((await repository.load('d'))?.file.name).toBe('Theirs')
    expect(await binding.load()).toBe(true)
    expect(c.getSnapshot().name).toBe('Theirs')
    add(c, 'After')
    await binding.flush()
    expect((await repository.load('d'))?.revision).toBe(3)
    binding.dispose()
  })

  it('reports a failed save and tries again at the next change', async () => {
    const inner = memoryRepository()
    let failing = true
    const repository = { ...inner, save: async (...args: Parameters<typeof inner.save>) => (failing ? Promise.reject(new Error('disk full')) : inner.save(...args)) }
    const errors: Error[] = []
    const c = createDiagramController()
    const binding = bindRepository(c, repository, { id: 'd', debounceMs: 60_000, onError: (e) => errors.push(e) })
    add(c, 'A')
    expect(await binding.flush()).toBe(false)
    expect(errors.map((e) => e.message)).toEqual(['disk full'])
    failing = false
    add(c, 'B')
    expect(await binding.flush()).toBe(true)
    expect((await inner.load('d'))?.file.nodes).toHaveLength(2)
    binding.dispose()
  })

  it('takes in a change that comes from somewhere else, without saving it back', async () => {
    let push: ((s: StoredDiagram) => void) | undefined
    const inner = memoryRepository()
    const repository = { ...inner, subscribe: (_id: string, cb: (s: StoredDiagram) => void) => ((push = cb), () => void 0) }
    const save = vi.spyOn(repository, 'save')
    const c = createDiagramController()
    const binding = bindRepository(c, repository, { id: 'd', debounceMs: 60_000 })
    push?.({ file: file('Remote'), revision: 9 })
    expect(c.getSnapshot()).toMatchObject({ name: 'Remote', revision: 9 })
    await binding.flush()
    expect(save).not.toHaveBeenCalled()
    binding.dispose()
  })
})
