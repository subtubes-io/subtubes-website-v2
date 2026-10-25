import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOST_CALLS, METHODS, isAllowed, isGranted, needsReapproval, parsePermission, readManifest, rpcMessageSchema, rpcResponseSchema, relayRequestSchema, RPC_ERROR_CODES, PLUGIN_API_VERSION, SUPPORTED_API_VERSIONS, describePermission, hostMatches, formatPermission, SIMPLE_PERMISSIONS, isInsideFolder } from './index'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const base = { id: 'acme.hello', name: 'Hello', version: '1.0.0', apiVersion: 1 }
const read = (manifest: unknown) => readManifest(JSON.stringify(manifest))
const problems = (manifest: unknown) => {
  const result = read(manifest)
  return result.ok ? [] : result.problems
}

describe('permissions', () => {
  it('reads the simple ones, and exec and net with their argument', () => {
    for (const name of SIMPLE_PERMISSIONS) expect(parsePermission(name)).toEqual({ ok: true, permission: { kind: 'simple', name } })
    expect(parsePermission('exec:ample')).toEqual({ ok: true, permission: { kind: 'exec', binary: 'ample' } })
    expect(parsePermission('net:ample.computer')).toEqual({ ok: true, permission: { kind: 'net', host: 'ample.computer' } })
    expect(parsePermission('net:*.ample.computer')).toEqual({ ok: true, permission: { kind: 'net', host: '*.ample.computer' } })
  })

  it('refuses what is not a permission, with a reason the author can act on', () => {
    for (const bad of ['', 'files', 'files.delete', 'shell', 'exec', 'exec:', 'exec:/bin/sh', 'exec:rm -rf', 'exec:a b', 'exec:../x', 'net:', 'net:localhost', 'net:https://a.com', 'net:a.com:8080', 'net:a.com/path', 'net:*', 'net:*.com.', 'net:a_b.com', 'FILES.READ']) {
      const parsed = parsePermission(bad)
      expect(parsed.ok, bad).toBe(false)
    }
    expect(parsePermission('nope')).toMatchObject({ ok: false, reason: expect.stringContaining('Known ones') })
  })

  it('writes a permission back the way it was read, and says in words what it means', () => {
    for (const text of ['files.write', 'exec:ample', 'net:*.example.org']) {
      const parsed = parsePermission(text)
      if (!parsed.ok) throw new Error(text)
      expect(formatPermission(parsed.permission)).toBe(text)
      expect(describePermission(parsed.permission).length).toBeGreaterThan(10)
    }
    expect(describePermission({ kind: 'net', host: '*.example.org' })).toContain('any subdomain of example.org')
  })

  it('matches hosts exactly, or by subdomain for a wildcard, and never by suffix tricks', () => {
    expect(hostMatches('ample.computer', 'ample.computer')).toBe(true)
    expect(hostMatches('ample.computer', 'API.ample.computer')).toBe(false)
    expect(hostMatches('*.ample.computer', 'api.ample.computer')).toBe(true)
    expect(hostMatches('*.ample.computer', 'a.b.ample.computer')).toBe(true)
    expect(hostMatches('*.ample.computer', 'ample.computer')).toBe(false)
    expect(hostMatches('*.ample.computer', 'evilample.computer')).toBe(false)
    expect(hostMatches('*.ample.computer', 'ample.computer.evil.com')).toBe(false)
  })
})

describe('the manifest', () => {
  it('reads the Ample example, with every permission it asks for', () => {
    const result = readManifest(fixture('ample.manifest.json'))
    if (!result.ok) throw new Error(result.problems.join('\n'))
    expect(result.manifest.contributes.chatTools.map((t) => t.id)).toEqual(['check', 'deploy'])
    expect(result.permissions.map(formatPermission)).toEqual(['node', 'exec:ample', 'net:ample.computer', 'files.read', 'llm.complete', 'chat.contribute'])
  })

  it('says where it shows up: the Design page unless it says more, and never twice or nowhere', () => {
    const none = read(base)
    if (!none.ok) throw new Error(none.problems.join('\n'))
    expect(none.manifest.workspaces).toEqual(['design'])
    const both = read({ ...base, workspaces: ['design', 'workspace'] })
    if (!both.ok) throw new Error(both.problems.join('\n'))
    expect(both.manifest.workspaces).toEqual(['design', 'workspace'])
    expect(read({ ...base, workspaces: ['workspace'] }).ok).toBe(true)
    expect(read({ ...base, workspaces: [] }).ok).toBe(false)
    expect(read({ ...base, workspaces: ['design', 'design'] }).ok).toBe(false)
    expect(read({ ...base, workspaces: ['elsewhere'] }).ok).toBe(false)
  })

  it('has pages for the Workspace’s main area, which need a ui part, the Workspace, and a sidebar view that is its own', () => {
    const page = { id: 'board', title: 'Board', icon: 'ListTodo', sidebarView: 'side' }
    const withPage = (extra: Record<string, unknown> = {}, contributes: Record<string, unknown> = {}) => ({
      ...base,
      workspaces: ['design', 'workspace'],
      ui: { entry: 'ui.js' },
      contributes: { sidebarViews: [{ id: 'side', title: 'Side', icon: 'ListTodo' }], pages: [page], ...contributes },
      ...extra,
    })
    const good = read(withPage())
    if (!good.ok) throw new Error(good.problems.join('\n'))
    expect(good.manifest.contributes.pages.map((p) => p.id)).toEqual(['board'])
    expect(read(base).ok && (read(base) as { manifest: { contributes: { pages: unknown[] } } }).manifest.contributes.pages).toEqual([])
    const problems = (input: unknown) => (read(input).ok ? [] : (read(input) as { problems: string[] }).problems.join('\n'))
    expect(problems(withPage({ ui: undefined }))).toMatch(/needs a ui entry/)
    expect(problems(withPage({ workspaces: ['design'] }))).toMatch(/Workspace page/)
    expect(problems(withPage({}, { pages: [{ ...page, sidebarView: 'other' }] }))).toMatch(/no sidebar view "other"/)
    expect(problems(withPage({}, { pages: [page, page] }))).toMatch(/Two pages are called "board"/)
    expect(read(withPage({}, { pages: [{ id: 'board', title: 'Board', icon: 'ListTodo' }] })).ok).toBe(true)
  })

  it('needs only an id, a name, a version and the API version; everything else is empty', () => {
    const result = read(base)
    if (!result.ok) throw new Error(result.problems.join('\n'))
    expect(result.manifest.permissions).toEqual([])
    expect(result.manifest.contributes).toMatchObject({ sidebarViews: [], chatTools: [], chatShortcuts: [], commands: [] })
    expect(PLUGIN_API_VERSION).toBe(1)
    expect(SUPPORTED_API_VERSIONS).toContain(PLUGIN_API_VERSION)
  })

  it('says when the file is not JSON, or not an object', () => {
    expect(readManifest('{nope')).toMatchObject({ ok: false, problems: [expect.stringContaining('not valid JSON')] })
    expect(readManifest('[]').ok).toBe(false)
    expect(readManifest('null').ok).toBe(false)
  })

  const BAD: [string, unknown, RegExp][] = [
    ['an id with capitals', { ...base, id: 'Acme.Hello' }, /^id: /],
    ['an id that is too short', { ...base, id: 'ab' }, /^id: /],
    ['an id that is a path', { ...base, id: '../evil' }, /^id: /],
    ['a version that is not semver', { ...base, version: '1.0' }, /^version: /],
    ['an API version that is newer than the app', { ...base, apiVersion: 2 }, /Update the app/],
    ['an API version of zero', { ...base, apiVersion: 0 }, /apiVersion/],
    ['a field it does not know', { ...base, colour: 'red' }, /colour|Unrecognized/i],
    ['a permission that does not exist', { ...base, permissions: [{ permission: 'files.delete', reason: 'x' }] }, /not a permission/],
    ['a permission with no reason', { ...base, permissions: [{ permission: 'files.read', reason: '' }] }, /reason/],
    ['an exec permission with a path', { ...base, permissions: [{ permission: 'exec:/bin/sh', reason: 'x' }] }, /command name/],
    ['a net permission with a scheme', { ...base, permissions: [{ permission: 'net:https://a.com', reason: 'x' }] }, /host name/],
    ['the same permission twice', { ...base, permissions: [{ permission: 'files.read', reason: 'a' }, { permission: 'files.read', reason: 'b' }] }, /listed twice/],
    ['a ui entry outside the folder', { ...base, ui: { entry: '../x.html' } }, /inside the plugin's folder/],
    ['an absolute ui entry', { ...base, ui: { entry: '/etc/x.html' } }, /inside the plugin's folder/],
    ['a ui entry with backslashes', { ...base, ui: { entry: 'a\\b.html' } }, /inside the plugin's folder/],
    ['a ui entry that is a URL', { ...base, ui: { entry: 'https://evil.com/x.html' } }, /inside the plugin's folder/],
    ['a ui entry that is not a module', { ...base, ui: { entry: 'panel.html' } }, /\.js or \.mjs/],
    ['a node entry that is not a module', { ...base, node: { entry: 'main.sh' }, permissions: [{ permission: 'node', reason: 'x' }] }, /\.js or \.mjs/],
    ['a node part without the node permission', { ...base, node: { entry: 'main.mjs' } }, /"node" permission/],
    ['the node permission without a node part', { ...base, permissions: [{ permission: 'node', reason: 'x' }] }, /node part/],
    ['a sidebar view without a page to show', { ...base, contributes: { sidebarViews: [{ id: 'v', title: 'V', icon: 'Rocket' }] } }, /needs a ui entry/],
    ['an icon that is a path', { ...base, ui: { entry: 'a.js' }, contributes: { sidebarViews: [{ id: 'v', title: 'V', icon: '../x.svg' }] } }, /icon/],
    ['a shortcut without chat.contribute', { ...base, contributes: { chatShortcuts: [{ word: '!hi', does: 'x', help: 'x', instructions: 'x' }] } }, /chat\.contribute/],
    ['a shortcut that is one of the app’s own', { ...base, permissions: [{ permission: 'chat.contribute', reason: 'x' }], contributes: { chatShortcuts: [{ word: '!gc', does: 'x', help: 'x', instructions: 'x' }] } }, /app’s own shortcuts/],
    ['a shortcut that is not a "!word"', { ...base, permissions: [{ permission: 'chat.contribute', reason: 'x' }], contributes: { chatShortcuts: [{ word: 'hi', does: 'x', help: 'x', instructions: 'x' }] } }, /"!"/],
    ['two tools with one name', { ...base, ui: { entry: 'a.js' }, permissions: [{ permission: 'chat.contribute', reason: 'x' }], contributes: { chatTools: [{ id: 't', description: 'x', inputSchema: { type: 'object' }, risk: 'read', runsIn: 'ui' }, { id: 't', description: 'y', inputSchema: { type: 'object' }, risk: 'read', runsIn: 'ui' }] } }, /Two chatTools are called "t"/],
    ['a tool that runs in a part it does not have', { ...base, ui: { entry: 'a.js' }, permissions: [{ permission: 'chat.contribute', reason: 'x' }], contributes: { chatTools: [{ id: 't', description: 'x', inputSchema: { type: 'object' }, risk: 'read', runsIn: 'node' }] } }, /does not have/],
    ['a tool whose input is not an object schema', { ...base, ui: { entry: 'a.js' }, permissions: [{ permission: 'chat.contribute', reason: 'x' }], contributes: { chatTools: [{ id: 't', description: 'x', inputSchema: { type: 'string' }, risk: 'read', runsIn: 'ui' }] } }, /inputSchema/],
    ['a tool with no risk', { ...base, ui: { entry: 'a.js' }, permissions: [{ permission: 'chat.contribute', reason: 'x' }], contributes: { chatTools: [{ id: 't', description: 'x', inputSchema: { type: 'object' }, runsIn: 'ui' }] } }, /risk/],
    ['a status item for a command that is not there', { ...base, ui: { entry: 'a.js' }, contributes: { statusItems: [{ id: 's', title: 'S', icon: 'Rocket', command: 'nope' }] } }, /no command "nope"/],
    ['a command with nothing to run it', { ...base, contributes: { commands: [{ id: 'c', title: 'C' }] } }, /needs a ui or node part/],
  ]

  for (const [what, manifest, message] of BAD) {
    it(`refuses ${what}, and says where`, () => {
      const found = problems(manifest)
      expect(found.length, what).toBeGreaterThan(0)
      expect(found.join('\n')).toMatch(message)
    })
  }

  it('keeps entry paths inside the plugin’s folder', () => {
    for (const good of ['panel.html', 'ui/panel.html', 'a/b/c.mjs']) expect(isInsideFolder(good), good).toBe(true)
    for (const bad of ['', '/a', '../a', 'a/../b', 'a//b', './a', 'a/./b', 'a\\b', 'C:a', 'c:/a', 'a\0b', 'x'.repeat(201)]) expect(isInsideFolder(bad), bad).toBe(false)
  })

  it('lists every problem, not only the first', () => {
    const found = problems({ id: 'X', name: '', version: 'one', apiVersion: 1 })
    expect(found.length).toBeGreaterThanOrEqual(3)
  })
})

describe('the method table', () => {
  const names = Object.keys(METHODS)
  const NAMESPACES = ['ui', 'storage', 'data', 'settings', 'host', 'files', 'designs', 'chat', 'reports', 'llm', 'git', 'exec', 'net', 'browser', 'node']
  // What a call asks for, for the methods whose permission depends on it.
  const probe = { binary: 'ample', url: 'https://ample.computer/x' }

  it('has every method in a known namespace, described, and callable from at least one part', () => {
    for (const name of names) {
      const def = METHODS[name as keyof typeof METHODS]
      expect(NAMESPACES, name).toContain(name.split('.')[0])
      expect(name).toMatch(/^[a-z]+\.[a-zA-Z]+$/)
      expect(def.description.length, name).toBeGreaterThan(10)
      expect(def.parts.length, name).toBeGreaterThan(0)
    }
    for (const ns of NAMESPACES) expect(names.some((n) => n.startsWith(`${ns}.`)), ns).toBe(true)
  })

  it('says for every method which permission it needs: none, or a real one', () => {
    for (const name of names) {
      const def = METHODS[name as keyof typeof METHODS]
      const needed = (def.needs as (p: unknown) => string | null)(probe)
      if (needed === null) continue
      expect(parsePermission(needed).ok, `${name} needs "${needed}"`).toBe(true)
    }
  })

  it('asks for a permission for everything that touches the person’s files, work, accounts or machine', () => {
    const open = ['ui.showMessage', 'ui.setBadge', 'ui.openPage', 'storage.get', 'storage.set', 'storage.delete', 'storage.keys', 'data.read', 'data.write', 'data.list', 'data.delete', 'settings.get', 'host.log', 'exec.read', 'exec.kill']
    for (const name of names) {
      const def = METHODS[name as keyof typeof METHODS]
      const needed = (def.needs as (p: unknown) => string | null)(probe)
      expect(needed === null, name).toBe(open.includes(name))
    }
  })

  it('offers nothing that hands out a credential, the server, or the shell', () => {
    for (const name of names) expect(name, name).not.toMatch(/token|secret|credential|password|invoke|shell|terminal|permission|approval/i)
    for (const call of Object.keys(HOST_CALLS)) expect(names, call).not.toContain(call)
  })

  it('has host calls that say what they need', () => {
    for (const [name, def] of Object.entries(HOST_CALLS)) {
      expect(def.description.length, name).toBeGreaterThan(10)
      if (def.needs !== null) expect(parsePermission(def.needs).ok, name).toBe(true)
    }
  })
})

describe('deciding a call', () => {
  const hasNothing: string[] = []

  it('lets an plugin use its own storage and log with no permission', () => {
    expect(isAllowed(hasNothing, 'ui', 'storage.set', { key: 'k', value: 1 })).toEqual({ allowed: true })
    expect(isAllowed(hasNothing, 'node', 'host.log', { message: 'hi' })).toEqual({ allowed: true })
  })

  it('refuses what was not granted, and says which permission it needs', () => {
    expect(isAllowed(hasNothing, 'ui', 'files.read', { path: 'a.ts' })).toMatchObject({ allowed: false, code: 'not-granted', needs: 'files.read' })
    expect(isAllowed(['files.read'], 'ui', 'files.read', { path: 'a.ts' })).toEqual({ allowed: true })
    // Reading is not writing, and one program is not another.
    expect(isAllowed(['files.read'], 'ui', 'files.write', { path: 'a.ts', content: 'x', summary: 's' })).toMatchObject({ code: 'not-granted', needs: 'files.write' })
    expect(isAllowed(['exec:ample'], 'node', 'exec.run', { binary: 'ample', args: ['--version'] })).toEqual({ allowed: true })
    expect(isAllowed(['exec:ample'], 'node', 'exec.run', { binary: 'sh', args: ['-c', 'id'] })).toMatchObject({ code: 'not-granted', needs: 'exec:sh' })
    expect(isAllowed(['exec:ample'], 'node', 'exec.run', { binary: 'ample/../sh' })).toMatchObject({ allowed: false })
  })

  it('checks the host of a request, not the text of the address', () => {
    const grants = ['net:ample.computer']
    expect(isAllowed(grants, 'node', 'net.fetch', { url: 'https://ample.computer/api' })).toEqual({ allowed: true })
    expect(isAllowed(grants, 'node', 'net.fetch', { url: 'https://api.ample.computer/' })).toMatchObject({ code: 'not-granted' })
    expect(isAllowed(grants, 'node', 'net.fetch', { url: 'https://ample.computer.evil.com/' })).toMatchObject({ code: 'not-granted' })
    expect(isAllowed(grants, 'node', 'net.fetch', { url: 'https://evil.com/?u=ample.computer' })).toMatchObject({ code: 'not-granted' })
    expect(isAllowed(grants, 'node', 'net.fetch', { url: 'https://ample.computer@evil.com/' })).toMatchObject({ code: 'not-granted' })
    expect(isAllowed(['net:*.ample.computer'], 'node', 'net.fetch', { url: 'https://api.ample.computer/' })).toEqual({ allowed: true })
    // Not a web address at all.
    expect(isAllowed(grants, 'node', 'net.fetch', { url: 'file:///etc/passwd' })).toMatchObject({ allowed: false })
    expect(isAllowed(grants, 'node', 'net.fetch', { url: 'javascript:alert(1)' })).toMatchObject({ allowed: false })
    expect(isGranted(['net:*.ample.computer'], 'net:ample.computer')).toBe(false)
  })

  it('refuses a method that does not exist, including names an object would have', () => {
    for (const name of ['nope.nothing', 'constructor', '__proto__', 'toString', 'hasOwnProperty', '']) expect(isAllowed(['files.read'], 'ui', name, {})).toMatchObject({ allowed: false, code: 'unknown-method' })
  })

  it('refuses parameters that are not what the method takes, before anything else', () => {
    expect(isAllowed(['files.read'], 'ui', 'files.read', {})).toMatchObject({ allowed: false, code: 'invalid-params' })
    expect(isAllowed(['files.read'], 'ui', 'files.read', { path: 5 })).toMatchObject({ allowed: false, code: 'invalid-params' })
    expect(isAllowed(['exec:ample'], 'node', 'exec.run', { binary: 'ample', args: 'not-a-list' })).toMatchObject({ code: 'invalid-params' })
    expect(isAllowed(['llm.complete'], 'node', 'llm.complete', { prompt: 'x'.repeat(50_001) })).toMatchObject({ code: 'invalid-params' })
    expect(isAllowed(['designs.write'], 'ui', 'designs.propose', { summary: 's', changes: [{ op: 'rm -rf' }] })).toMatchObject({ code: 'invalid-params' })
  })

  it('never lets the grants an plugin names for itself count: only the list it is given', () => {
    expect(isAllowed(['files.read'], 'ui', 'files.read', { path: 'a', grants: ['files.write'] })).toEqual({ allowed: true })
    expect(isAllowed(['files.read'], 'ui', 'files.write', { path: 'a', content: 'x', summary: 's', grants: ['files.write'] })).toMatchObject({ code: 'not-granted' })
  })

  it('knows when an update asks for more than was agreed to', () => {
    expect(needsReapproval(['files.read', 'exec:ample'], ['files.read'])).toEqual([])
    expect(needsReapproval(['files.read'], ['files.read', 'exec:ample', 'net:a.com'])).toEqual(['exec:ample', 'net:a.com'])
  })
})

describe('the messages', () => {
  const base = { protocol: 'subtubes-plugin' }

  it('reads a request, a response either way and an event, and nothing with another protocol', () => {
    expect(rpcMessageSchema.safeParse({ ...base, kind: 'request', id: '1', method: 'files.read', params: { path: 'a' } }).success).toBe(true)
    expect(rpcMessageSchema.safeParse({ ...base, kind: 'response', id: '1', ok: true, result: { content: '' } }).success).toBe(true)
    expect(rpcResponseSchema.safeParse({ ...base, kind: 'response', id: '1', ok: false, error: { code: 'not-granted', message: 'no', needs: 'files.read' } }).success).toBe(true)
    expect(rpcMessageSchema.safeParse({ ...base, kind: 'event', name: 'x' }).success).toBe(true)
    expect(rpcMessageSchema.safeParse({ protocol: 'other', kind: 'event', name: 'x' }).success).toBe(false)
    expect(rpcMessageSchema.safeParse({ ...base, kind: 'request', id: '', method: 'x' }).success).toBe(false)
    expect(rpcResponseSchema.safeParse({ ...base, kind: 'response', id: '1', ok: false, error: { code: 'whatever', message: 'x' } }).success).toBe(false)
  })

  it('has an error code for every way a call can be refused', () => {
    for (const code of ['unknown-method', 'wrong-part', 'invalid-params', 'not-granted']) expect(RPC_ERROR_CODES).toContain(code)
  })

  it('carries a call from the server to the window and says which part made it', () => {
    expect(relayRequestSchema.safeParse({ kind: 'relay-request', relayId: 'r1', pluginId: 'acme.hello', part: 'node', method: 'reports.create', params: {} }).success).toBe(true)
    expect(relayRequestSchema.safeParse({ kind: 'relay-request', relayId: 'r1', pluginId: 'acme.hello', method: 'reports.create' }).success).toBe(false)
  })
})

describe('the design document', () => {
  const doc = readFileSync(resolve(__dirname, '../../../docs/plugins.md'), 'utf8')

  it('names every method, every host call and every permission, so it does not drift from the table', () => {
    for (const name of [...Object.keys(METHODS), ...Object.keys(HOST_CALLS)]) expect(doc, name).toContain(`\`${name}\``)
    for (const name of SIMPLE_PERMISSIONS) expect(doc, name).toContain(`\`${name}\``)
    expect(doc).toContain('`exec:<binary>`')
    expect(doc).toContain('`net:<host>`')
  })

  it('shows a manifest that the schema accepts', () => {
    const block = /```json\n([\s\S]*?)\n```/.exec(doc)?.[1]
    if (!block) throw new Error('no manifest in the document')
    const result = readManifest(block)
    if (!result.ok) throw new Error(result.problems.join('\n'))
    expect(result.manifest.id).toBe('ample.computer')
  })
})
