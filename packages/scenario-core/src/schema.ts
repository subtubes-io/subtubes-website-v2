import { z } from 'zod'
import { defineFormat, readVersioned, readVersionedOrThrow } from '@subtubes/diagram-core/versioning'
import { scenarioSchema } from './scenarioSchema'
import type { ScenarioFile } from './types'

export const SCENARIO_SCHEMA_VERSION = 1

// The scenario shape itself is shared with the createScenario tool, so the assistant writes what the app reads.
export { scenarioSchema } from './scenarioSchema'

// Version 1 of the scenario file format. Frozen once released.
export const scenarioFileV1Schema: z.ZodType<ScenarioFile> = z.strictObject({
  schemaVersion: z.literal(SCENARIO_SCHEMA_VERSION),
  scenarios: z.array(scenarioSchema),
})

export const scenarioFileSchema = scenarioFileV1Schema

// Every version the app can read, oldest first, ending with the current one.
export const scenarioFileFormat = defineFormat<ScenarioFile>({
  name: 'scenario file',
  history: [{ version: SCENARIO_SCHEMA_VERSION, schema: scenarioFileV1Schema }],
})

// Throws a typed error; use for trusted input such as bundled samples.
export function parseScenarioFile(input: unknown): ScenarioFile {
  return readVersionedOrThrow(scenarioFileFormat, input)
}

// Returns a result instead of throwing; use for user-supplied files.
export function readScenarioFile(input: unknown) {
  return readVersioned(scenarioFileFormat, input)
}
