import { z } from 'zod'
import { diagramOpSchema } from '@subtubes/diagram-core'
import { hostMatches, parsePermission } from './permissions'

// The plugin API as data: every method an plugin can call on the app, with its parameters, its result, the permission it
// needs, and which part of the plugin may call it. Nothing here runs. The same table is what the host and the broker use to
// validate a call and to decide whether to allow it, and what the typed `PluginApi` below is derived from, so a method cannot
// exist without saying what it needs (a test checks every entry).
//
// "ui" is the plugin's page, in a sandboxed frame; "node" is its own process. Both reach the app only through this table.

export type Part = 'ui' | 'node'

// The permission a call needs, from what is being asked. A permission that cannot be written down (a bad URL) is one nobody can hold.
type Needs<P> = (params: P) => string | null

interface MethodDef<P extends z.ZodType, R extends z.ZodType> {
  description: string
  parts: readonly Part[]
  params: P
  result: R
  // null: no permission is needed (the plugin's own things).
  needs: Needs<z.output<P>>
}

function method<P extends z.ZodType, R extends z.ZodType>(def: MethodDef<P, R>): MethodDef<P, R> {
  return def
}

const none = () => null
const permission = (name: string) => () => name

const path = z.string().min(1).max(500).describe('A path relative to the project root, with forward slashes.')
const key = z.string().min(1).max(200)
const empty = z.object({}).strict()
const ok = z.object({ ok: z.literal(true) })
// Where a plugin keeps a stored value: with the project (in .subtubes/plugins/<id>/, so it can be committed and shared) or with the person (private, in the app's data folder).
const scope = z.enum(['project', 'user']).default('project')

// How much of the answer to a call is kept, so one call cannot fill the channel.
export const API_LIMITS = {
  maxMessageBytes: 4 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxPromptChars: 50_000,
  maxStorageBytes: 5 * 1024 * 1024,
  // The plugin's own data folder.
  maxDataBytes: 50 * 1024 * 1024,
  // What a plugin may add to a report's context (per plugin).
  maxReportContextChars: 4000,
  maxExecOutputBytes: 64 * 1024,
  maxFetchBytes: 1024 * 1024,
  maxExecSeconds: 600,
  // A program started with exec.start may run longer (a deploy), and the app keeps this much of what it prints, per stream.
  maxExecStartSeconds: 1800,
  maxExecKeptBytes: 4 * 1024 * 1024,
  maxExecReadBytes: 512 * 1024,
  maxRunningPrograms: 6,
  maxFetchSeconds: 60,
} as const

// Environment a plugin may add to a program it runs (the app's own settings are never passed on, whatever the plugin asks).
const programEnv = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(64), z.string().max(1000)).refine((env) => Object.keys(env).length <= 20, 'At most 20 variables.').optional()

const hostOf = (url: string): string => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.hostname : ''
  } catch {
    return ''
  }
}

export const METHODS = {
  // ---- the app's window (always allowed; they only touch what the plugin drew or what the person can already see) ----
  'ui.showMessage': method({
    description: 'Show a short message to the person.',
    parts: ['ui', 'node'],
    params: z.object({ text: z.string().min(1).max(500), level: z.enum(['info', 'warn', 'error']).default('info') }),
    result: ok,
    needs: none,
  }),
  'ui.setBadge': method({
    description: 'Show a count on the icon of one of the plugin’s sidebar views, or clear it.',
    parts: ['ui', 'node'],
    params: z.object({ viewId: z.string().min(1).max(48), count: z.number().int().min(0).max(999).nullable() }),
    result: ok,
    needs: none,
  }),
  'ui.setAssistantContext': method({
    description: 'Tell the Workspace assistant what the plugin’s open page is showing, so it can answer about it (replaces what was said before; empty text clears it). Only while one of the plugin’s pages is open.',
    parts: ['ui'],
    params: z.object({ text: z.string().max(4000) }),
    result: ok,
    needs: permission('chat.contribute'),
  }),
  'ui.openPage': method({
    description: 'Open one of the plugin’s own pages in the Workspace.',
    parts: ['ui'],
    params: z.object({ pageId: z.string().min(1).max(48) }),
    result: ok,
    needs: none,
  }),
  'ui.openFile': method({
    description: 'Open a project file in the file viewer, at a line.',
    parts: ['ui', 'node'],
    params: z.object({ path, line: z.number().int().min(1).optional() }),
    result: ok,
    needs: permission('files.read'),
  }),
  'ui.openDesign': method({
    description: 'Open a design.',
    parts: ['ui', 'node'],
    params: z.object({ id: z.string().min(1).max(200) }),
    result: ok,
    needs: permission('designs.read'),
  }),
  'ui.openReport': method({
    description: 'Open a report in the Reports view.',
    parts: ['ui', 'node'],
    params: z.object({ id: z.string().min(1).max(200) }),
    result: ok,
    needs: permission('reports.read'),
  }),

  // ---- the plugin's own storage and settings ----
  'storage.get': method({
    description: 'Read a value the plugin stored.',
    parts: ['ui', 'node'],
    params: z.object({ key, scope }),
    result: z.object({ value: z.unknown().nullable() }),
    needs: none,
  }),
  'storage.set': method({
    description: 'Store a JSON value. The plugin’s whole store is limited in size.',
    parts: ['ui', 'node'],
    params: z.object({ key, value: z.unknown(), scope }),
    result: ok,
    needs: none,
  }),
  'storage.delete': method({ description: 'Remove a stored value.', parts: ['ui', 'node'], params: z.object({ key, scope }), result: ok, needs: none }),
  'storage.keys': method({ description: 'The keys that are stored.', parts: ['ui', 'node'], params: z.object({ scope }), result: z.object({ keys: z.array(z.string()) }), needs: none }),
  'settings.get': method({
    description: 'The values of the plugin’s settings (those it declared in its manifest), as the person set them.',
    parts: ['ui', 'node'],
    params: empty,
    result: z.object({ values: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])) }),
    needs: none,
  }),
  'host.log': method({
    description: 'Write a line to the plugin’s log, which the person can read in Settings > Plugins.',
    parts: ['ui', 'node'],
    params: z.object({ level: z.enum(['debug', 'info', 'warn', 'error']).default('info'), message: z.string().max(2000) }),
    result: ok,
    needs: none,
  }),

  // ---- the plugin's own private folder (<app data>/plugins/<id>/data/): no permission needed, nothing outside it is reachable ----
  'data.read': method({
    description: 'Read a text file from the plugin’s own data folder (null when there is none).',
    parts: ['node'],
    params: z.object({ path }),
    result: z.object({ content: z.string().nullable() }),
    needs: none,
  }),
  'data.write': method({
    description: 'Write a text file in the plugin’s own data folder (folders are made as needed). The folder is limited in size.',
    parts: ['node'],
    params: z.object({ path, content: z.string().max(API_LIMITS.maxFileBytes) }),
    result: ok,
    needs: none,
  }),
  'data.list': method({
    description: 'The files in the plugin’s own data folder, or in a folder of it.',
    parts: ['node'],
    params: z.object({ dir: z.string().max(500).default('.') }),
    result: z.object({ entries: z.array(z.object({ name: z.string(), path: z.string(), kind: z.enum(['file', 'dir']), size: z.number().int().optional() })) }),
    needs: none,
  }),
  'data.delete': method({ description: 'Remove a file from the plugin’s own data folder.', parts: ['node'], params: z.object({ path }), result: ok, needs: none }),

  // ---- project files (the same jail as the assistant: no .git, .env*, keys, node_modules) ----
  'files.list': method({
    description: 'List a folder of the project.',
    parts: ['ui', 'node'],
    params: z.object({ dir: z.string().max(500).default('.') }),
    result: z.object({ entries: z.array(z.object({ name: z.string(), path: z.string(), kind: z.enum(['file', 'dir']), size: z.number().int().optional() })), truncated: z.boolean() }),
    needs: permission('files.read'),
  }),
  'files.read': method({
    description: 'Read a text file of the project.',
    parts: ['ui', 'node'],
    params: z.object({ path }),
    result: z.object({ content: z.string(), truncated: z.boolean(), hash: z.string() }),
    needs: permission('files.read'),
  }),
  'files.search': method({
    description: 'Search the project’s text files.',
    parts: ['ui', 'node'],
    params: z.object({ query: z.string().min(1).max(200), glob: z.string().max(200).optional(), maxResults: z.number().int().min(1).max(200).default(50) }),
    result: z.object({ matches: z.array(z.object({ path: z.string(), line: z.number().int(), text: z.string() })), truncated: z.boolean() }),
    needs: permission('files.read'),
  }),
  'files.watch': method({
    description: 'Be told (the "files.changed" call) when files matching these patterns change.',
    parts: ['ui', 'node'],
    params: z.object({ globs: z.array(z.string().min(1).max(200)).min(1).max(20) }),
    result: ok,
    needs: permission('files.read'),
  }),
  'files.write': method({
    description: 'Write a text file inside the project’s write folder. In Review mode the person approves it first; if they decline, the result says so.',
    parts: ['ui', 'node'],
    params: z.object({ path, content: z.string().max(API_LIMITS.maxFileBytes), summary: z.string().min(1).max(300) }),
    result: z.discriminatedUnion('status', [z.object({ status: z.literal('written'), created: z.boolean() }), z.object({ status: z.literal('declined') })]),
    needs: permission('files.write'),
  }),

  // ---- the open design ----
  'designs.getOpen': method({
    description: 'The open design: nodes, edges and scenarios.',
    parts: ['ui', 'node'],
    params: empty,
    result: z.object({
      id: z.string(),
      name: z.string(),
      revision: z.number().int(),
      nodes: z.array(z.object({ id: z.string(), title: z.string(), layer: z.string().optional(), color: z.string().optional(), body: z.string() })),
      edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), label: z.string().optional() })),
      scenarios: z.array(z.object({ id: z.string(), title: z.string() })),
    }),
    needs: permission('designs.read'),
  }),
  'designs.propose': method({
    description: 'Propose changes to the open design, as one batch. The person approves them first, as they do for the assistant; the result says what happened.',
    parts: ['ui', 'node'],
    params: z.object({ summary: z.string().min(1).max(300), expectedRevision: z.number().int().optional(), changes: z.array(diagramOpSchema).min(1).max(200) }),
    result: z.discriminatedUnion('status', [z.object({ status: z.literal('applied'), revision: z.number().int() }), z.object({ status: z.literal('declined') }), z.object({ status: z.literal('stale'), revision: z.number().int() })]),
    needs: permission('designs.write'),
  }),

  // ---- the assistant ----
  'chat.send': method({
    description: 'Send a message to the design assistant, as if the person had typed it. It shows in the chat as sent by the plugin.',
    parts: ['ui', 'node'],
    params: z.object({ text: z.string().min(1).max(10_000) }),
    result: ok,
    needs: permission('chat.send'),
  }),
  'chat.getConversation': method({
    description: 'The text of the current conversation with the design assistant.',
    parts: ['ui', 'node'],
    params: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
    result: z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })) }),
    needs: permission('chat.read'),
  }),

  // ---- reports ----
  'reports.list': method({
    description: 'The saved reports.',
    parts: ['ui', 'node'],
    params: empty,
    result: z.object({ reports: z.array(z.object({ id: z.string(), title: z.string(), commit: z.string(), createdAt: z.number() })) }),
    needs: permission('reports.read'),
  }),
  'reports.get': method({
    description: 'One report’s text.',
    parts: ['ui', 'node'],
    params: z.object({ id: z.string().min(1).max(200) }),
    result: z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      commit: z.string(),
      features: z.array(z.object({ title: z.string(), body: z.string() })),
      issues: z.array(z.object({ severity: z.string(), title: z.string(), body: z.string() })),
    }),
    needs: permission('reports.read'),
  }),
  'reports.create': method({
    description: 'Make and save a report about a commit (the newest when none is given), the way the "+" shortcuts do.',
    parts: ['ui', 'node'],
    params: z.object({ commit: z.string().regex(/^[0-9a-f]{7,64}$/i).optional() }),
    result: z.object({ reportId: z.string(), title: z.string(), commit: z.string() }),
    needs: permission('reports.create'),
  }),

  // ---- the model (the key stays with the server) ----
  'llm.complete': method({
    description: 'Ask the person’s chosen model for text, once. No tools, no history.',
    parts: ['ui', 'node'],
    params: z.object({ system: z.string().max(API_LIMITS.maxPromptChars).optional(), prompt: z.string().min(1).max(API_LIMITS.maxPromptChars), maxOutputTokens: z.number().int().min(1).max(8000).default(1000) }),
    result: z.object({ text: z.string(), model: z.string() }),
    needs: permission('llm.complete'),
  }),

  // ---- git (read only) ----
  'git.status': method({
    description: 'Whether the project is a repository, its branch and whether it has changes.',
    parts: ['ui', 'node'],
    params: empty,
    result: z.object({ isRepo: z.boolean(), branch: z.string().nullable(), head: z.string().nullable(), dirty: z.boolean() }),
    needs: permission('git.read'),
  }),
  'git.log': method({
    description: 'The latest commits.',
    parts: ['ui', 'node'],
    params: z.object({ limit: z.number().int().min(1).max(200).default(30) }),
    result: z.object({ commits: z.array(z.object({ commit: z.string(), subject: z.string(), author: z.string(), committedAt: z.string() })) }),
    needs: permission('git.read'),
  }),
  'git.diff': method({
    description: 'The diff of a commit (the newest when none is given), optionally for one file.',
    parts: ['ui', 'node'],
    params: z.object({ commit: z.string().regex(/^[0-9a-f]{7,64}$/i).optional(), path: path.optional() }),
    result: z.object({ diff: z.string(), truncated: z.boolean() }),
    needs: permission('git.read'),
  }),

  // ---- programs and the network (named in the manifest, nothing else) ----
  'exec.run': method({
    description: 'Run a program from the manifest’s list, in the project folder, with an argument list (never through a shell). Output is cut to its last part and it stops after a time limit.',
    parts: ['ui', 'node'],
    params: z.object({
      binary: z.string().min(1).max(64),
      args: z.array(z.string().max(4000)).max(100).default([]),
      cwd: z.string().max(500).optional(),
      stdin: z.string().max(100_000).optional(),
      env: programEnv,
      timeoutSeconds: z.number().int().min(1).max(API_LIMITS.maxExecSeconds).default(60),
    }),
    result: z.object({ exitCode: z.number().int().nullable(), signal: z.string().nullable(), timedOut: z.boolean(), stdout: z.string(), stderr: z.string(), truncated: z.boolean() }),
    needs: (params) => `exec:${params.binary}`,
  }),
  'exec.start': method({
    description: 'Start a program from the manifest’s list and return at once, for one that runs for a long time (a deploy). Read what it prints with exec.read; exec.kill stops it. Same rules as exec.run, with a longer time limit.',
    parts: ['ui', 'node'],
    params: z.object({
      binary: z.string().min(1).max(64),
      args: z.array(z.string().max(4000)).max(100).default([]),
      cwd: z.string().max(500).optional(),
      env: programEnv,
      timeoutSeconds: z.number().int().min(1).max(API_LIMITS.maxExecStartSeconds).default(600),
    }),
    result: z.object({ id: z.string() }),
    needs: (params) => `exec:${params.binary}`,
  }),
  'exec.read': method({
    description: 'What a program started with exec.start has printed since the offsets given (start at 0, then pass back outNext and errNext), and whether it has finished.',
    parts: ['ui', 'node'],
    params: z.object({ id: z.string().min(1).max(64), outFrom: z.number().int().min(0).default(0), errFrom: z.number().int().min(0).default(0) }),
    result: z.object({
      stdout: z.string(),
      stderr: z.string(),
      outNext: z.number().int(),
      errNext: z.number().int(),
      done: z.boolean(),
      exitCode: z.number().int().nullable(),
      signal: z.string().nullable(),
      timedOut: z.boolean(),
      // Some of the output was dropped because it was too long (the start is kept).
      truncated: z.boolean(),
    }),
    // Only the plugin that started the program can read it (the app keeps the list per plugin), so there is no permission of its own.
    needs: none,
  }),
  'exec.kill': method({
    description: 'Stop a program started with exec.start.',
    parts: ['ui', 'node'],
    params: z.object({ id: z.string().min(1).max(64) }),
    result: ok,
    needs: none,
  }),
  'net.fetch': method({
    description: 'Make an HTTP request to a host from the manifest’s list, through the app. Redirects to other hosts are not followed.',
    parts: ['ui', 'node'],
    params: z.object({
      url: z.string().url().max(2000),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
      headers: z.record(z.string(), z.string().max(2000)).optional(),
      body: z.string().max(API_LIMITS.maxFileBytes).optional(),
      timeoutSeconds: z.number().int().min(1).max(API_LIMITS.maxFetchSeconds).default(30),
    }),
    result: z.object({ status: z.number().int(), headers: z.record(z.string(), z.string()), body: z.string(), truncated: z.boolean() }),
    needs: (params) => `net:${hostOf(params.url)}`,
  }),
  'browser.open': method({
    description: 'Open a web address in the built-in browser or the default one.',
    parts: ['ui', 'node'],
    // Only web addresses: never javascript:, file: or anything else a page could be made to run.
    params: z.object({ url: z.string().url().max(2000).refine((url) => /^https?:\/\//i.test(url), 'Only http and https addresses.'), where: z.enum(['builtin', 'default']).default('builtin') }),
    result: ok,
    needs: permission('browser.open'),
  }),

  // ---- the two parts of one plugin talk through the app ----
  'node.call': method({
    description: 'Call a method of the plugin’s node part and wait for its answer.',
    parts: ['ui'],
    params: z.object({ method: z.string().min(1).max(64), params: z.unknown().optional() }),
    result: z.object({ result: z.unknown() }),
    needs: permission('node'),
  }),
  'node.send': method({
    description: 'Send a JSON message to the plugin’s other part (ui to node, or node to ui). It arrives as the "node.message" call.',
    parts: ['ui', 'node'],
    params: z.object({ message: z.unknown() }),
    result: ok,
    needs: permission('node'),
  }),
} as const

export type MethodName = keyof typeof METHODS
export type ParamsOf<M extends MethodName> = z.input<(typeof METHODS)[M]['params']>
export type ResultOf<M extends MethodName> = z.output<(typeof METHODS)[M]['result']>

type Namespace<N extends string> = {
  [M in MethodName as M extends `${N}.${infer F}` ? F : never]: (params: ParamsOf<M>) => Promise<ResultOf<M>>
}

// What an plugin's code is handed: `api.files.read({ path })`, `api.llm.complete({ prompt })`. The same for the ui part and the
// node part; a call the other part may not make is refused by the host (see `isAllowed`).
export interface PluginApi {
  ui: Namespace<'ui'>
  storage: Namespace<'storage'>
  data: Namespace<'data'>
  settings: Namespace<'settings'>
  host: Namespace<'host'>
  files: Namespace<'files'>
  designs: Namespace<'designs'>
  chat: Namespace<'chat'>
  reports: Namespace<'reports'>
  llm: Namespace<'llm'>
  git: Namespace<'git'>
  exec: Namespace<'exec'>
  net: Namespace<'net'>
  browser: Namespace<'browser'>
  node: Namespace<'node'>
}

// ---- what the app asks of an plugin (the other direction) ----

interface HostCallDef<P extends z.ZodType, R extends z.ZodType> {
  description: string
  // Which part of the plugin is called.
  to: readonly Part[]
  params: P
  result: R
  // The permission the plugin needs to be sent this at all, or null.
  needs: string | null
}

function hostCall<P extends z.ZodType, R extends z.ZodType>(def: HostCallDef<P, R>): HostCallDef<P, R> {
  return def
}

export const HOST_CALLS = {
  'lifecycle.activate': hostCall({
    description: 'The plugin is starting. It is told what it may do, so it can say so instead of failing.',
    to: ['ui', 'node'],
    params: z.object({ apiVersion: z.number().int(), grants: z.array(z.string()) }),
    result: z.object({}).passthrough(),
    needs: null,
  }),
  'lifecycle.deactivate': hostCall({ description: 'The plugin is being stopped or disabled. It has a few seconds to tidy up.', to: ['ui', 'node'], params: empty, result: z.object({}).passthrough(), needs: null }),
  'command.run': hostCall({ description: 'The person chose one of the plugin’s commands (or clicked its status item).', to: ['ui', 'node'], params: z.object({ commandId: z.string() }), result: z.object({}).passthrough(), needs: null }),
  'settings.changed': hostCall({ description: 'The person changed one of the plugin’s settings.', to: ['ui', 'node'], params: z.object({ values: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])) }), result: z.object({}).passthrough(), needs: null }),
  'chat.shortcut': hostCall({
    description: 'The person sent one of the plugin’s shortcuts. The assistant is given its instructions; the plugin can do its own part (the note is any text after the word).',
    to: ['ui', 'node'],
    params: z.object({ word: z.string(), note: z.string() }),
    result: z.object({}).passthrough(),
    needs: 'chat.contribute',
  }),
  'tool.invoke': hostCall({
    description: 'The assistant called one of the plugin’s tools. The input was checked against the tool’s schema; the output goes back to the model as data.',
    to: ['ui', 'node'],
    params: z.object({ tool: z.string(), callId: z.string(), input: z.unknown() }),
    result: z.object({ output: z.unknown() }),
    needs: 'chat.contribute',
  }),
  'files.changed': hostCall({ description: 'Files matching a watch changed.', to: ['ui', 'node'], params: z.object({ paths: z.array(z.string()).max(200) }), result: z.object({}).passthrough(), needs: 'files.read' }),
  'report.context': hostCall({
    description: 'A report is about to be written about these commits. The plugin answers with what it knows about them (or nothing), as short text. It is used to write the report and is not kept with it.',
    to: ['ui', 'node'],
    params: z.object({
      commits: z.array(z.object({ sha: z.string(), subject: z.string(), committedAt: z.string() })).max(200),
      files: z.array(z.string()).max(500),
      branch: z.string().nullable(),
    }),
    result: z.object({ title: z.string().min(1).max(80), text: z.string().max(API_LIMITS.maxReportContextChars) }).nullable(),
    needs: 'reports.contribute',
  }),
  'node.invoke': hostCall({
    description: 'The plugin’s ui part called one of the methods of its node part (node.call). The node part answers with the method’s result.',
    to: ['node'],
    params: z.object({ method: z.string().min(1).max(64), params: z.unknown().optional() }),
    result: z.object({ result: z.unknown() }),
    needs: 'node',
  }),
  'node.message': hostCall({ description: 'The plugin’s other part sent a message.', to: ['ui', 'node'], params: z.object({ message: z.unknown() }), result: z.object({}).passthrough(), needs: 'node' }),
} as const

export type HostCallName = keyof typeof HOST_CALLS

// ---- deciding ----

export type Decision =
  | { allowed: true }
  | { allowed: false; code: 'unknown-method'; message: string }
  | { allowed: false; code: 'wrong-part'; message: string }
  | { allowed: false; code: 'invalid-params'; message: string }
  | { allowed: false; code: 'not-granted'; needs: string; message: string }

// Whether a permission text is covered by what was granted: the same permission, or (for net) a granted host pattern that covers it.
export function isGranted(grants: readonly string[], needed: string): boolean {
  if (grants.includes(needed)) return true
  const want = parsePermission(needed)
  if (!want.ok || want.permission.kind !== 'net') return false
  const host = want.permission.host
  return grants.some((g) => {
    const have = parsePermission(g)
    return have.ok && have.permission.kind === 'net' && hostMatches(have.permission.host, host)
  })
}

// The one decision every call goes through, in the host and again in the broker: does this plugin, calling from this part, with
// these grants, get to make this call? Pure, so it is the same everywhere. `grants` are the permissions the manifest asked for AND
// the person agreed to; asking is not having.
export function isAllowed(grants: readonly string[], part: Part, name: string, params: unknown): Decision {
  if (!Object.hasOwn(METHODS, name)) return { allowed: false, code: 'unknown-method', message: `There is no method "${name}".` }
  const def = METHODS[name as MethodName]
  if (!def.parts.includes(part)) return { allowed: false, code: 'wrong-part', message: `${name} cannot be called from the ${part} part.` }
  const parsed = def.params.safeParse(params ?? {})
  if (!parsed.success) return { allowed: false, code: 'invalid-params', message: parsed.error.issues.map((i) => `${i.path.join('.') || 'params'}: ${i.message}`).join('; ') }
  const needed = (def.needs as Needs<unknown>)(parsed.data)
  if (needed !== null && !isGranted(grants, needed)) return { allowed: false, code: 'not-granted', needs: needed, message: `${name} needs the "${needed}" permission, which this plugin does not have.` }
  return { allowed: true }
}
