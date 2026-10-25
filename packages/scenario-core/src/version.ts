import type { Scenario } from './types'

// Bump when the engine's behaviour changes in a way that can change a trace (new condition
// semantics, a different way of choosing the next step). A recorded result carries the version
// it was made with, so a replay under a newer engine can say why the result may differ.
export const ENGINE_VERSION = 1

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// A short fingerprint of a scenario's content (FNV-1a over its canonical JSON). It tells a
// recorded result whether the scenario it ran has been edited since; it is not a security hash.
export function scenarioVersion(scenario: Scenario): string {
  const text = stable(scenario)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
