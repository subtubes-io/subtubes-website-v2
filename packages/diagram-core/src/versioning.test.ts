import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  MigrationError,
  NotADocumentError,
  UnsupportedVersionError,
  ValidationError,
  defineFormat,
  describeVersionError,
  readVersioned,
  readVersionedOrThrow,
  serializeVersioned,
  writeVersioned,
} from './versioning'

// A three-version format to exercise chained migrations, warnings and failures.
const v1 = z.strictObject({ schemaVersion: z.literal(1), name: z.string(), done: z.boolean() })
const v2 = z.strictObject({ schemaVersion: z.literal(2), name: z.string(), status: z.enum(['open', 'done']) })
const v3 = z.strictObject({
  schemaVersion: z.literal(3),
  title: z.string(),
  status: z.enum(['open', 'done']),
  tags: z.array(z.string()),
})
type Current = z.infer<typeof v3>

const format = defineFormat<Current>({
  name: 'task',
  history: [
    { version: 1, schema: v1, migrate: (d) => ({ data: { schemaVersion: 2, name: d.name, status: d.done ? 'done' : 'open' } }) },
    {
      version: 2,
      schema: v2,
      migrate: (d) => ({
        data: { schemaVersion: 3, title: d.name, status: d.status, tags: [] },
        warnings: ['tags did not exist before; started empty'],
      }),
    },
    { version: 3, schema: v3 },
  ],
})

const v1Doc = { schemaVersion: 1, name: 'Write plan', done: true }

describe('readVersioned', () => {
  it('chains migrations oldest to current and collects warnings', () => {
    const result = readVersioned(format, v1Doc)
    expect(result).toEqual({
      ok: true,
      from: 1,
      upgraded: true,
      warnings: ['tags did not exist before; started empty'],
      value: { schemaVersion: 3, title: 'Write plan', status: 'done', tags: [] },
    })
  })

  it('upgrades from the middle without redoing earlier steps', () => {
    const result = readVersioned(format, { schemaVersion: 2, name: 'x', status: 'open' })
    expect(result.ok && result.value.title).toBe('x')
    expect(result.ok && result.from).toBe(2)
  })

  it('passes a current document through unchanged', () => {
    const doc = { schemaVersion: 3, title: 't', status: 'open', tags: ['a'] }
    const result = readVersioned(format, doc)
    expect(result).toEqual({ ok: true, from: 3, upgraded: false, warnings: [], value: doc })
  })

  it('judges a file by the rules of its own version, not today\'s', () => {
    // 'done: true' is valid v1 but would be rejected by v3; the v1 schema is what applies.
    expect(readVersioned(format, v1Doc).ok).toBe(true)
    const bad = readVersioned(format, { schemaVersion: 1, name: 'x', done: 'yes' })
    expect(!bad.ok && bad.error).toBeInstanceOf(ValidationError)
    expect(!bad.ok && bad.error instanceof ValidationError && bad.error.version).toBe(1)
  })

  it('rejects things that are not documents', () => {
    for (const input of [null, 'text', 7, [], {}, { schemaVersion: 'one' }, { schemaVersion: 0 }, { schemaVersion: 1.5 }]) {
      const result = readVersioned(format, input)
      expect(!result.ok && result.error).toBeInstanceOf(NotADocumentError)
    }
  })

  it('refuses newer files instead of guessing', () => {
    const result = readVersioned(format, { schemaVersion: 4 })
    expect(!result.ok && result.error).toBeInstanceOf(UnsupportedVersionError)
    expect(!result.ok && result.error instanceof UnsupportedVersionError && result.error.reason).toBe('too-new')
  })

  it('reports files older than the oldest supported version', () => {
    const dropped = defineFormat<Current>({
      name: 'task',
      history: [
        {
          version: 2,
          schema: v2,
          migrate: (d) => ({ data: { schemaVersion: 3, title: d.name, status: d.status, tags: [] } }),
        },
        { version: 3, schema: v3 },
      ],
    })
    const result = readVersioned(dropped, v1Doc)
    expect(!result.ok && result.error instanceof UnsupportedVersionError && result.error.reason).toBe('too-old')
    expect(dropped.minSupported).toBe(2)
  })

  it('reports a migration that throws, or that produces invalid output, as a bug', () => {
    const throwing = defineFormat<Current>({
      name: 'task',
      history: [
        {
          version: 2,
          schema: v2,
          migrate: () => {
            throw new Error('boom')
          },
        },
        { version: 3, schema: v3 },
      ],
    })
    const thrown = readVersioned(throwing, { schemaVersion: 2, name: 'x', status: 'open' })
    expect(!thrown.ok && thrown.error).toBeInstanceOf(MigrationError)

    const broken = defineFormat<Current>({
      name: 'task',
      history: [{ version: 2, schema: v2, migrate: () => ({ data: { schemaVersion: 3, title: 1 } }) }, { version: 3, schema: v3 }],
    })
    const invalid = readVersioned(broken, { schemaVersion: 2, name: 'x', status: 'open' })
    expect(!invalid.ok && invalid.error).toBeInstanceOf(MigrationError)
    expect(!invalid.ok && invalid.error.cause).toBeInstanceOf(ValidationError)
  })

  it('does not mutate its input', () => {
    const doc = structuredClone(v1Doc)
    readVersioned(format, doc)
    expect(doc).toEqual(v1Doc)
  })

  it('is idempotent: re-reading the output changes nothing', () => {
    const first = readVersionedOrThrow(format, v1Doc)
    const second = readVersioned(format, first)
    expect(second.ok && second.upgraded).toBe(false)
    expect(second.ok && second.value).toEqual(first)
  })
})

describe('defineFormat', () => {
  it('requires ascending versions and a migrate on every version but the last', () => {
    expect(() => defineFormat<Current>({ name: 'x', history: [{ version: 2, schema: v2 }, { version: 3, schema: v3 }] })).toThrow(/migrate/)
    expect(() =>
      defineFormat<Current>({
        name: 'x',
        history: [{ version: 3, schema: v3, migrate: (d) => ({ data: d }) }, { version: 3, schema: v3 }],
      }),
    ).toThrow(/ascending/)
  })
})

describe('writing', () => {
  it('writes the current version and refuses invalid values', () => {
    const value: Current = { schemaVersion: 3, title: 't', status: 'open', tags: [] }
    expect(writeVersioned(format, value)).toEqual(value)
    expect(serializeVersioned(format, value)).toBe(JSON.stringify(value, null, 2) + '\n')
    expect(() => writeVersioned(format, { ...value, tags: 'x' } as unknown as Current)).toThrow()
  })
})

describe('describeVersionError', () => {
  it('gives each failure a next step', () => {
    const msg = (input: unknown) => {
      const r = readVersioned(format, input)
      return r.ok ? '' : describeVersionError(r.error)
    }
    expect(msg({ schemaVersion: 9 })).toMatch(/Update the app/)
    expect(msg({ schemaVersion: 1, name: 5, done: true })).toMatch(/invalid at name/)
    expect(msg('nope')).toMatch(/not a valid task file/)
  })
})
