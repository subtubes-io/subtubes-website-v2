import type { z } from 'zod'

// Upgrade on read, current-only in memory.
//
// A persisted document carries a version number. Each released version keeps a frozen schema
// that is never edited. Reading validates the document against the schema of the version it
// was written with, then runs pure migrations (vN -> vN+1, chained) until it matches the
// current schema. The rest of the app only ever sees the current shape.

// ---- Typed errors: failures are data, so the UI can say what to do next ----

export class NotADocumentError extends Error {
  readonly kind = 'not-a-document' as const
  readonly format: string
  constructor(format: string, detail: string) {
    super(`Not a ${format} document: ${detail}`)
    this.format = format
  }
}

export class UnsupportedVersionError extends Error {
  readonly kind = 'unsupported-version' as const
  readonly format: string
  readonly found: number
  readonly minSupported: number
  readonly current: number
  readonly reason: 'too-old' | 'too-new' | 'unknown'
  constructor(format: string, found: number, minSupported: number, current: number, reason: 'too-old' | 'too-new' | 'unknown') {
    super(`${format} version ${found} is not supported (supported: ${minSupported}-${current})`)
    this.format = format
    this.found = found
    this.minSupported = minSupported
    this.current = current
    this.reason = reason
  }
}

export class ValidationError extends Error {
  readonly kind = 'validation' as const
  readonly format: string
  readonly version: number
  readonly issues: z.core.$ZodIssue[]
  constructor(format: string, version: number, issues: z.core.$ZodIssue[]) {
    super(`Invalid ${format} (v${version}): ${issues[0]?.message ?? 'unknown problem'}`)
    this.format = format
    this.version = version
    this.issues = issues
  }
}

// A bug in a migration, not the user's fault: log it.
export class MigrationError extends Error {
  readonly kind = 'migration' as const
  readonly format: string
  readonly from: number
  readonly to: number
  constructor(format: string, from: number, to: number, cause: unknown) {
    super(`Migrating ${format} from v${from} to v${to} failed`, { cause })
    this.format = format
    this.from = from
    this.to = to
  }
}

export type VersionError = NotADocumentError | UnsupportedVersionError | ValidationError | MigrationError

// ---- Formats ----

export interface MigrationResult {
  data: unknown
  // Anything lossy or assumed; shown to the user once after opening.
  warnings?: string[]
}

export interface VersionDef {
  version: number
  // Frozen once released.
  schema: z.ZodType
  // Turns data of this version into the next version's shape. Pure: no I/O, no randomness.
  // Required on every version except the last.
  migrate?: (data: any) => MigrationResult
}

export interface CurrentVersionDef<T> {
  version: number
  schema: z.ZodType<T>
}

export interface Format<T> {
  name: string
  versionField: string
  history: VersionDef[]
  readonly current: number
  readonly minSupported: number
  readonly currentSchema: z.ZodType<T>
}

// `history` is ordered oldest first and ends with the current version. Dropping an old
// version from the front drops support for it (such files read as 'too-old').
export function defineFormat<T>(def: {
  name: string
  versionField?: string
  history: [...VersionDef[], CurrentVersionDef<T>]
}): Format<T> {
  const history = def.history as VersionDef[]
  if (history.length === 0) throw new Error(`${def.name}: a format needs at least one version`)

  history.forEach((entry, i) => {
    if (i > 0 && entry.version <= history[i - 1].version) {
      throw new Error(`${def.name}: versions must be strictly ascending`)
    }
    const last = i === history.length - 1
    if (!last && !entry.migrate) throw new Error(`${def.name}: v${entry.version} needs a migrate function`)
  })

  const last = history[history.length - 1]
  return {
    name: def.name,
    versionField: def.versionField ?? 'schemaVersion',
    history,
    current: last.version,
    minSupported: history[0].version,
    currentSchema: last.schema as z.ZodType<T>,
  }
}

export type ReadResult<T> =
  | { ok: true; value: T; from: number; upgraded: boolean; warnings: string[] }
  | { ok: false; error: VersionError }

export interface ReadOptions {
  // Check every migration step against the next version's schema, not only the final result.
  validateSteps?: boolean
}

export function readVersioned<T>(format: Format<T>, input: unknown, options: ReadOptions = {}): ReadResult<T> {
  const { validateSteps = true } = options
  const fail = (error: VersionError): ReadResult<T> => ({ ok: false, error })

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail(new NotADocumentError(format.name, 'expected an object'))
  }
  const found = (input as Record<string, unknown>)[format.versionField]
  if (typeof found !== 'number' || !Number.isInteger(found) || found < 1) {
    return fail(new NotADocumentError(format.name, `missing a valid ${format.versionField}`))
  }

  if (found > format.current) {
    return fail(new UnsupportedVersionError(format.name, found, format.minSupported, format.current, 'too-new'))
  }
  if (found < format.minSupported) {
    return fail(new UnsupportedVersionError(format.name, found, format.minSupported, format.current, 'too-old'))
  }
  const start = format.history.findIndex((h) => h.version === found)
  if (start < 0) {
    return fail(new UnsupportedVersionError(format.name, found, format.minSupported, format.current, 'unknown'))
  }

  // The file is judged by the rules of the version it was written under.
  const first = format.history[start].schema.safeParse(input)
  if (!first.success) return fail(new ValidationError(format.name, found, first.error.issues))

  let data: unknown = first.data
  const warnings: string[] = []

  for (let i = start; i < format.history.length - 1; i++) {
    const from = format.history[i]
    const to = format.history[i + 1]
    let result: MigrationResult
    try {
      result = from.migrate!(data)
    } catch (cause) {
      return fail(new MigrationError(format.name, from.version, to.version, cause))
    }
    warnings.push(...(result.warnings ?? []))

    // A failure here means the migration produced something its target version rejects.
    const check = to.schema.safeParse(result.data)
    if (!check.success) {
      if (validateSteps || i === format.history.length - 2) {
        return fail(
          new MigrationError(format.name, from.version, to.version, new ValidationError(format.name, to.version, check.error.issues)),
        )
      }
    } else {
      result = { ...result, data: check.data }
    }
    data = result.data
  }

  return { ok: true, value: data as T, from: found, upgraded: start < format.history.length - 1, warnings }
}

// For trusted input such as bundled samples: throws the typed error.
export function readVersionedOrThrow<T>(format: Format<T>, input: unknown, options?: ReadOptions): T {
  const result = readVersioned(format, input, options)
  if (!result.ok) throw result.error
  return result.value
}

// Writing always produces the current version, and refuses anything invalid.
export function writeVersioned<T>(format: Format<T>, value: T): T {
  return format.currentSchema.parse(value)
}

export function serializeVersioned<T>(format: Format<T>, value: T, space = 2): string {
  return JSON.stringify(writeVersioned(format, value), null, space) + '\n'
}

// A message for the user, with a next step.
export function describeVersionError(error: VersionError): string {
  switch (error.kind) {
    case 'not-a-document':
      return `This is not a valid ${error.format} file. ${error.message.split(': ')[1] ?? ''}`.trim()
    case 'unsupported-version':
      if (error.reason === 'too-new') {
        return `This ${error.format} was made by a newer version of the app (file version ${error.found}, this app supports up to ${error.current}). Update the app to open it.`
      }
      return `This ${error.format} is too old to open directly (file version ${error.found}, this app supports ${error.minSupported} and up). Convert it with an older release first.`
    case 'validation': {
      const issue = error.issues[0]
      const where = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
      return `This ${error.format} file is invalid${where}: ${issue?.message ?? 'unknown problem'}.`
    }
    case 'migration':
      return `Upgrading this ${error.format} from version ${error.from} to ${error.to} failed. This is a bug in the app; please report it.`
  }
}
