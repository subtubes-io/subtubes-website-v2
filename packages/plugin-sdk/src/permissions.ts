import { z } from 'zod'

// What an plugin can ask the person for. Nothing here runs: it is the vocabulary the manifest, the host and the broker share.
// A plugin has only what is in its manifest AND was agreed to; the host checks both sides (see isAllowed in ./api.ts).

// Permissions that stand alone.
export const SIMPLE_PERMISSIONS = [
  'files.read',
  'files.write',
  'designs.read',
  'designs.write',
  'chat.contribute',
  'chat.send',
  'chat.read',
  'reports.read',
  'reports.create',
  // Adds what it knows about a commit to the context of a report written about that commit.
  'reports.contribute',
  'llm.complete',
  'git.read',
  'browser.open',
  // May have a Node part: a process of its own, started and stopped by the app.
  'node',
] as const

export type SimplePermission = (typeof SIMPLE_PERMISSIONS)[number]

// A command name only: never a path, so the host (not the plugin) decides where it is found.
const BINARY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
// A host name, or "*.host" for any subdomain of it. No scheme, port or path.
const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

export type Permission = { kind: 'simple'; name: SimplePermission } | { kind: 'exec'; binary: string } | { kind: 'net'; host: string }

export type PermissionParse = { ok: true; permission: Permission } | { ok: false; reason: string }

export function parsePermission(text: string): PermissionParse {
  if ((SIMPLE_PERMISSIONS as readonly string[]).includes(text)) return { ok: true, permission: { kind: 'simple', name: text as SimplePermission } }
  const colon = text.indexOf(':')
  const head = colon < 0 ? text : text.slice(0, colon)
  const tail = colon < 0 ? '' : text.slice(colon + 1)
  if (head === 'exec') return BINARY.test(tail) ? { ok: true, permission: { kind: 'exec', binary: tail } } : { ok: false, reason: 'exec:<binary> takes a command name, such as exec:ample (no path, no spaces).' }
  if (head === 'net') return HOST.test(tail) ? { ok: true, permission: { kind: 'net', host: tail } } : { ok: false, reason: 'net:<host> takes a host name such as net:ample.computer, or *.ample.computer for subdomains (no scheme, port or path).' }
  return { ok: false, reason: `"${text}" is not a permission. Known ones: ${SIMPLE_PERMISSIONS.join(', ')}, exec:<binary>, net:<host>.` }
}

export const permissionSchema = z.string().superRefine((text, ctx) => {
  const parsed = parsePermission(text)
  if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.reason })
})

export const formatPermission = (permission: Permission): string => (permission.kind === 'simple' ? permission.name : permission.kind === 'exec' ? `exec:${permission.binary}` : `net:${permission.host}`)

// Whether a host name is covered by a granted net permission: the same host, or a subdomain when it was "*.host".
export function hostMatches(granted: string, host: string): boolean {
  const target = host.toLowerCase()
  if (granted.startsWith('*.')) return target.endsWith(granted.slice(1)) && target.length > granted.length - 1
  return target === granted
}

// What each permission means, in the words the person is shown when they are asked.
export const PERMISSION_TEXT: Record<SimplePermission, string> = {
  'files.read': 'Read the files in your project (not .env files, keys or .git).',
  'files.write': 'Create and change files in the project, the same way the assistant can. In Review mode you approve each write.',
  'designs.read': 'Read the open design: its nodes, edges and scenarios.',
  'designs.write': 'Propose changes to the open design. You approve them first, as with the assistant.',
  'chat.contribute': 'Add tools and shortcuts to the assistant.',
  'chat.send': 'Send messages to the assistant as if you had typed them.',
  'chat.read': 'Read your conversation with the assistant.',
  'reports.read': 'Read your saved reports.',
  'reports.create': 'Make and save reports about commits.',
  'reports.contribute': 'Add what it knows about a commit (its notes, tasks, deploys) to the context a report is written from. You can turn it off for a plugin at any time, and what it adds is used to write the report, not kept with it.',
  'llm.complete': 'Ask your chosen model to write text. Your API key is never shown to the plugin.',
  'git.read': 'Read git status, history and diffs.',
  'browser.open': 'Open web addresses in the built-in browser or your default browser.',
  node: 'Run a program of its own on your computer, with the access listed here and no more.',
}

export const describePermission = (permission: Permission): string =>
  permission.kind === 'simple' ? PERMISSION_TEXT[permission.name] : permission.kind === 'exec' ? `Run the program "${permission.binary}" with arguments it chooses (never through a shell).` : `Connect to ${permission.host.startsWith('*.') ? `any subdomain of ${permission.host.slice(2)}` : permission.host}.`
