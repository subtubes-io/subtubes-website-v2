import { z } from 'zod'
import { formatPermission, parsePermission, permissionSchema } from './permissions'
import type { Permission } from './permissions'
import { MAX_TOOL_NAME, toolName, toolSchemaProblems } from './toolSchema'
import { PLUGIN_API_VERSION, MANIFEST_FILE, SUPPORTED_API_VERSIONS } from './version'

// subtubes-plugin.json: what an plugin is, what it adds to the app, and what it asks for. It is read before anything of the
// plugin runs, and everything in it is data: the host shows it to the person (permissions with their reasons, chat instructions)
// before the plugin is enabled. Unknown fields are refused, so a typo is an error and not a silently ignored promise.

const id = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/, 'Use lower-case letters, digits and hyphens, with dots to group them (for example "acme.ample-deploy").')

// A name used inside one plugin (a view, command or tool): unique within its kind, so the host can address it as "<plugin id>/<id>".
const localId = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Start with a letter; letters, digits, "_" and "-" only.')

const semver = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'A version such as 1.2.3.')

// A file inside the plugin's folder. No way out of it: no absolute path, no "..", no backslashes or drive letters.
export function isInsideFolder(path: string): boolean {
  if (path.length === 0 || path.length > 200) return false
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path)) return false
  return path.split('/').every((part) => part !== '..' && part !== '' && part !== '.')
}

const entry = (plugins: readonly string[], what: string) =>
  z
    .string()
    .refine(isInsideFolder, `${what} must be a path inside the plugin's folder (no leading "/", no "..").`)
    .refine((path) => plugins.some((e) => path.endsWith(e)), `${what} must end in ${plugins.join(' or ')}.`)

// An icon is the name of one the app ships (the host has the list; an unknown name shows a default). Never a path or a URL.
const icon = z.string().regex(/^[A-Z][A-Za-z0-9]{0,40}$/, 'The name of an icon, such as "Rocket".')

const sidebarView = z
  .object({
    id: localId,
    title: z.string().min(1).max(40),
    icon,
    // Where in the activity bar. The app's own views use 5 to 30.
    order: z.number().int().min(0).max(1000).optional(),
  })
  .strict()

// A page for the main area of the Workspace, beside a sidebar. It is a place in the activity bar of its own: choosing it shows the plugin's
// `Main` in the main area, and `sidebarView` (one of the plugin's own sidebar views) in the sidebar.
const page = z
  .object({
    id: localId,
    title: z.string().min(1).max(40),
    icon,
    order: z.number().int().min(0).max(1000).optional(),
    sidebarView: localId.optional(),
  })
  .strict()

const statusItem = z
  .object({
    id: localId,
    title: z.string().min(1).max(40),
    // The text for a tooltip.
    tooltip: z.string().max(200).optional(),
    icon,
    // The command that runs when it is clicked.
    command: localId.optional(),
  })
  .strict()

const command = z.object({ id: localId, title: z.string().min(1).max(60) }).strict()

// The words the app's own shortcuts use are not available. (The app checks this list is the same as its own: src/plugins/reserved.test.ts.)
export const RESERVED_SHORTCUT_WORDS = ['!gc', '!gc+', '!gcp', '!gcp+'] as const
const RESERVED = new Set<string>(RESERVED_SHORTCUT_WORDS)

const chatShortcut = z
  .object({
    word: z
      .string()
      .regex(/^![a-z][a-z0-9]{0,15}\+?$/, 'A "!", a lower-case word, and optionally a "+" (for example "!ship").')
      .refine((word) => !RESERVED.has(word), 'That word is one of the app’s own shortcuts.'),
    // A few words, shown beside the word in the chat.
    does: z.string().min(1).max(80),
    // The tooltip on the button.
    help: z.string().min(1).max(300),
    // What the assistant is told to do when the person sends it. Shown to the person before the plugin is enabled: it is an
    // instruction to the model, and it is treated as the plugin's, not the person's.
    instructions: z.string().min(1).max(4000),
  })
  .strict()

const chatTool = z
  .object({
    id: localId,
    description: z.string().min(1).max(1000),
    // JSON Schema for the input, an object. Checked again by the host on every call.
    inputSchema: z.object({ type: z.literal('object') }).passthrough(),
    // "write" tools are not offered in Ask mode and follow the Approvals switch.
    risk: z.enum(['read', 'write']),
    // Which part of the plugin answers a call.
    runsIn: z.enum(['ui', 'node']),
  })
  .strict()

const settingField = z
  .object({
    key: localId,
    label: z.string().min(1).max(80),
    type: z.enum(['string', 'boolean', 'number']),
    default: z.union([z.string().max(500), z.boolean(), z.number()]).optional(),
    help: z.string().max(300).optional(),
  })
  .strict()

export const contributesSchema = z
  .object({
    sidebarViews: z.array(sidebarView).max(5).default([]),
    pages: z.array(page).max(5).default([]),
    statusItems: z.array(statusItem).max(5).default([]),
    commands: z.array(command).max(50).default([]),
    chatShortcuts: z.array(chatShortcut).max(10).default([]),
    chatTools: z.array(chatTool).max(30).default([]),
    settings: z.array(settingField).max(30).default([]),
    // The plugin can say what it knows about a commit, for the reports written about it (the "report.context" call). Needs reports.contribute.
    reportContext: z.boolean().default(false),
  })
  .strict()

const permissionRequest = z
  .object({
    permission: permissionSchema,
    // Why, in the plugin's words. Shown next to what the permission means.
    reason: z.string().min(1).max(200),
  })
  .strict()

// The places in the app a plugin shows up: the Design page (the open design, its sidebar and the design assistant) and the Workspace page (the
// sidebar and assistant for plugins, with no design and no code). Its sidebar views, pages and chat tools appear only where it says.
export const WORKSPACES = ['design', 'workspace'] as const
export type PluginWorkspace = (typeof WORKSPACES)[number]

export const manifestSchema = z
  .object({
    id,
    name: z.string().min(1).max(60),
    version: semver,
    // The version of the plugin API this was written for.
    apiVersion: z.number().int().min(1),
    description: z.string().max(300).optional(),
    // The part that shows things: an ES module loaded into the app's window. It is trusted code (not sandboxed): install only what you trust.
    ui: z.object({ entry: entry(['.js', '.mjs'], 'ui.entry') }).strict().optional(),
    // The part that runs on its own: an ES module, run in its own process (needs the "node" permission).
    node: z.object({ entry: entry(['.js', '.mjs'], 'node.entry') }).strict().optional(),
    // Where it shows up. Without it, on the Design page only (how plugins have always worked).
    workspaces: z.array(z.enum(WORKSPACES)).min(1).max(WORKSPACES.length).default(['design']),
    contributes: contributesSchema.default(() => contributesSchema.parse({})),
    permissions: z.array(permissionRequest).max(30).default([]),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })

    if (!SUPPORTED_API_VERSIONS.includes(manifest.apiVersion)) {
      issue(['apiVersion'], manifest.apiVersion > PLUGIN_API_VERSION ? `This app speaks plugin API version ${PLUGIN_API_VERSION}; the plugin needs ${manifest.apiVersion}. Update the app.` : `Plugin API version ${manifest.apiVersion} is no longer supported.`)
    }

    if (new Set(manifest.workspaces).size !== manifest.workspaces.length) issue(['workspaces'], 'A place is listed twice.')

    // The same permission twice is a mistake, and so is a second spelling of one.
    const seen = new Set<string>()
    manifest.permissions.forEach((request, index) => {
      const parsed = parsePermission(request.permission)
      if (!parsed.ok) return
      const key = formatPermission(parsed.permission)
      if (seen.has(key)) issue(['permissions', index, 'permission'], `"${key}" is listed twice.`)
      seen.add(key)
    })

    const unique = (kind: string, ids: string[]) =>
      ids.forEach((value, index) => {
        if (ids.indexOf(value) !== index) issue(['contributes', kind, index], `Two ${kind} are called "${value}".`)
      })
    const c = manifest.contributes
    unique('sidebarViews', c.sidebarViews.map((v) => v.id))
    unique('pages', c.pages.map((v) => v.id))
    unique('statusItems', c.statusItems.map((v) => v.id))
    unique('commands', c.commands.map((v) => v.id))
    unique('chatTools', c.chatTools.map((v) => v.id))
    unique('chatShortcuts', c.chatShortcuts.map((v) => v.word))
    unique('settings', c.settings.map((v) => v.key))

    // What it adds needs something to run it, and the permission to do it.
    const has = (name: string) => seen.has(name)
    const needsUi = c.sidebarViews.length > 0 || c.pages.length > 0
    if (needsUi && !manifest.ui) issue(['ui'], 'A sidebar view or a page needs a ui entry to show.')
    if (c.pages.length > 0 && !manifest.workspaces.includes('workspace')) issue(['workspaces'], 'Pages are shown on the Workspace page; add "workspace" to "workspaces".')
    c.pages.forEach((p, index) => {
      if (p.sidebarView && !c.sidebarViews.some((v) => v.id === p.sidebarView)) issue(['contributes', 'pages', index, 'sidebarView'], `There is no sidebar view "${p.sidebarView}".`)
    })
    if (manifest.node && !has('node')) issue(['permissions'], 'A plugin with a node part needs the "node" permission.')
    if (!manifest.node && has('node')) issue(['node'], 'The "node" permission is for plugins that have a node part; add one or remove the permission.')
    if ((c.chatShortcuts.length > 0 || c.chatTools.length > 0) && !has('chat.contribute')) issue(['permissions'], 'Chat shortcuts and tools need the "chat.contribute" permission.')
    if (c.reportContext && !has('reports.contribute')) issue(['permissions'], 'Giving context to reports needs the "reports.contribute" permission.')
    if (c.reportContext && !manifest.ui && !manifest.node) issue(['contributes', 'reportContext'], 'Giving context to reports needs a ui or node part to answer.')
    c.chatTools.forEach((tool, index) => {
      for (const problem of toolSchemaProblems(tool.inputSchema)) issue(['contributes', 'chatTools', index, 'inputSchema'], problem)
      if (toolName(manifest.id, tool.id).length > MAX_TOOL_NAME) issue(['contributes', 'chatTools', index, 'id'], `The tool's full name (${toolName(manifest.id, tool.id)}) is longer than ${MAX_TOOL_NAME} characters; shorten the plugin id or the tool id.`)
      if (tool.runsIn === 'node' && !manifest.node) issue(['contributes', 'chatTools', index, 'runsIn'], 'This tool runs in the node part, which this plugin does not have.')
      if (tool.runsIn === 'ui' && !manifest.ui) issue(['contributes', 'chatTools', index, 'runsIn'], 'This tool runs in the ui part, which this plugin does not have.')
    })
    c.statusItems.forEach((item, index) => {
      if (item.command && !c.commands.some((cmd) => cmd.id === item.command)) issue(['contributes', 'statusItems', index, 'command'], `There is no command "${item.command}".`)
    })
    if (c.commands.length > 0 && !manifest.ui && !manifest.node) issue(['contributes', 'commands'], 'A command needs a ui or node part to run it.')
  })

export type Manifest = z.infer<typeof manifestSchema>
export type ManifestInput = z.input<typeof manifestSchema>

export type ManifestRead = { ok: true; manifest: Manifest; permissions: Permission[] } | { ok: false; problems: string[] }

// Reads the text of a manifest file. Every problem is listed, each with where it is, so a person (or the assistant helping them)
// can fix them all in one go.
export function readManifest(text: string): ManifestRead {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { ok: false, problems: [`${MANIFEST_FILE} is not valid JSON: ${error instanceof Error ? error.message : 'unreadable'}`] }
  }
  const parsed = manifestSchema.safeParse(json)
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.length > 0 ? `${i.path.join('.')}: ` : ''}${i.message}`) }
  const permissions = parsed.data.permissions.flatMap((p) => {
    const permission = parsePermission(p.permission)
    return permission.ok ? [permission.permission] : []
  })
  return { ok: true, manifest: parsed.data, permissions }
}
