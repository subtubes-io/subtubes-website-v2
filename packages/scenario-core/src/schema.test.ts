import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { UnsupportedVersionError } from '@subtubes/diagram-core/versioning'
import { parseScenarioFile, readScenarioFile, scenarioFileFormat, scenarioFileV1Schema } from './schema'

// fixtures/scenarios.v1.json is a golden file: v1 exactly as released. Never edit it.
const text = readFileSync(new URL('./fixtures/scenarios.v1.json', import.meta.url), 'utf8')

describe('scenario file format', () => {
  it('reads the v1 golden fixture without upgrading it', () => {
    const result = readScenarioFile(JSON.parse(text))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.from).toBe(1)
    expect(result.upgraded).toBe(false)
    expect(result.value.scenarios.map((s) => s.id)).toEqual(['ai-edit', 'replay', 'user-edit'])
  })

  it('rejects an invalid scenario with a path to the problem', () => {
    const doc = JSON.parse(text)
    doc.scenarios[0].start = 'nope'
    const result = readScenarioFile(doc)
    expect(result.ok).toBe(false)
    expect(() => parseScenarioFile(doc)).toThrow(/Start step "nope"/)
  })

  it('refuses a newer file', () => {
    const result = readScenarioFile({ ...JSON.parse(text), schemaVersion: 2 })
    expect(!result.ok && result.error).toBeInstanceOf(UnsupportedVersionError)
  })

  it('knows its supported range', () => {
    expect(scenarioFileFormat.minSupported).toBe(1)
    expect(scenarioFileFormat.current).toBe(1)
  })

  // Fails if the released v1 schema is edited. To change the format, add a v2 instead.
  it('has not changed the released v1 schema', async () => {
    const json = JSON.stringify(z.toJSONSchema(scenarioFileV1Schema, { unrepresentable: 'any' }), null, 2) + '\n'
    await expect(json).toMatchFileSnapshot('./fixtures/scenarios.v1.schema.json')
  })
})
