import { describe, expect, it } from 'vitest'
import type { DiagramRepository } from '../repository'
import type { DiagramFile } from '../types'
import { DIAGRAM_SCHEMA_VERSION } from '../format'

const file = (name: string): DiagramFile => ({ schemaVersion: DIAGRAM_SCHEMA_VERSION, name, groups: [], nodes: [{ id: 'a', title: 'A', x: 0, y: 0, w: 160, h: 80, body: '' }], edges: [] })

// What every DiagramRepository must do. `make` returns a fresh, empty repository each time.
export function defineRepositoryConformance(name: string, make: () => DiagramRepository) {
  describe(`DiagramRepository: ${name}`, () => {
    it('has nothing for an id it was never given', async () => {
      expect(await make().load('nope')).toBeNull()
    })

    it('gives back what was saved, with the revision it was saved at', async () => {
      const repository = make()
      await repository.save('d1', file('One'), { revision: 1, baseRevision: null })
      expect(await repository.load('d1')).toEqual({ file: file('One'), revision: 1 })
      await repository.save('d1', file('One, later'), { revision: 4, baseRevision: 1 })
      expect(await repository.load('d1')).toEqual({ file: file('One, later'), revision: 4 })
    })

    it('keeps diagrams apart by id', async () => {
      const repository = make()
      await repository.save('a', file('A'), { revision: 1, baseRevision: null })
      await repository.save('b', file('B'), { revision: 1, baseRevision: null })
      expect((await repository.load('a'))?.file.name).toBe('A')
      expect((await repository.load('b'))?.file.name).toBe('B')
    })

    it('refuses a save made on top of a revision that is no longer the stored one, and keeps what is stored', async () => {
      const repository = make()
      await repository.save('d', file('first'), { revision: 1, baseRevision: null })
      await repository.save('d', file('second'), { revision: 2, baseRevision: 1 })
      await expect(repository.save('d', file('stale'), { revision: 2, baseRevision: 1 })).rejects.toMatchObject({ name: 'RepositoryConflictError' })
      await expect(repository.save('d', file('again from nothing'), { revision: 1, baseRevision: null })).rejects.toMatchObject({ name: 'RepositoryConflictError' })
      expect((await repository.load('d'))?.file.name).toBe('second')
    })
  })
}
