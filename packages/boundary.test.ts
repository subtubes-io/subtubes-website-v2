import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// The packages are the reusable part. What keeps them reusable is what they do not import: nothing of the app (src, shared, server), and of
// the other packages only the ones they are built on. This fails the moment one of them reaches outside.

const root = resolve(__dirname)
const ALLOWED: Record<string, { packages: string[]; modules: string[] }> = {
  'diagram-core': { packages: [], modules: ['zod', 'zustand/vanilla'] },
  'diagram-react': { packages: ['@subtubes/diagram-core'], modules: ['react', 'react/jsx-runtime', 'zustand', 'zustand/vanilla'] },
  'diagram-agent-tools': { packages: ['@subtubes/diagram-core'], modules: ['zod'] },
  'scenario-core': { packages: ['@subtubes/diagram-core'], modules: ['zod'] },
  'scenario-react': { packages: ['@subtubes/scenario-core'], modules: ['react', 'react/jsx-runtime', 'zustand'] },
  'plugin-sdk': { packages: ['@subtubes/diagram-core'], modules: ['zod'] },
}
// What a test may use besides.
const TEST_MODULES = ['vitest', 'node:fs', 'node:path', 'node:url']

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

// The modules a file imports: `import x from 'm'`, `} from 'm'` (the end of a longer import), `import 'm'` and `import('m')`, each at the start of a line.
const specifiers = (source: string) =>
  [...source.matchAll(/^(?:\s*(?:import|export)\b.*|\s*\}.*)\bfrom\s+['"]([^'"]+)['"]\s*$|^\s*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3])

describe('finding what a file imports', () => {
  it('sees every form, and not words in comments or strings', () => {
    const source = [
      "import { a } from '../../src/app'",
      'import {',
      '  b,',
      "} from '@subtubes/diagram-core'",
      "import 'side-effect'",
      "export * from './x'",
      "const m = await import('lazy')",
      "// the import ', ' of a list",
      'const text = "from \'nothing\'"',
    ].join('\n')
    expect(specifiers(source)).toEqual(['../../src/app', '@subtubes/diagram-core', 'side-effect', './x', 'lazy'])
  })
})

describe('the diagram packages', () => {
  for (const [name, allowed] of Object.entries(ALLOWED)) {
    it(`${name} imports nothing of the app and only what it is built on`, () => {
      const dir = join(root, name, 'src')
      const problems: string[] = []
      let seen = 0
      for (const file of files(dir)) {
        const isTest = /\.test\.tsx?$/.test(file) || file.includes(`${sep}testing${sep}`)
        for (const spec of specifiers(readFileSync(file, 'utf8'))) {
          seen++
          const at = `${relative(root, file)} imports "${spec}"`
          if (spec.startsWith('.')) {
            const target = resolve(dirname(file), spec)
            if (!target.startsWith(join(root, name) + sep)) problems.push(`${at}: outside the package`)
          } else if (spec.startsWith('@subtubes/')) {
            const base = spec.split('/').slice(0, 2).join('/')
            if (!allowed.packages.includes(base)) problems.push(`${at}: a package it is not built on`)
          } else if (!allowed.modules.includes(spec) && !(isTest && TEST_MODULES.includes(spec))) {
            problems.push(`${at}: a module it does not declare`)
          }
        }
      }
      expect(seen).toBeGreaterThan(3)
      expect(problems).toEqual([])
    })

    it(`${name} declares what it needs in its package.json and exports its entry`, () => {
      const manifest = JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8')) as { name: string; exports: Record<string, string>; peerDependencies?: Record<string, string> }
      expect(manifest.name).toBe(`@subtubes/${name}`)
      expect(Object.keys(manifest.exports)).toContain('.')
      const peers = Object.keys(manifest.peerDependencies ?? {})
      for (const wanted of [...allowed.packages, ...allowed.modules.map((m) => m.split('/')[0])]) {
        expect(peers, `${name} should list ${wanted}`).toContain(wanted)
      }
    })
  }
})
