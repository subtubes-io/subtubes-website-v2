import { z } from 'zod'

// The messages between the parts. Three links carry the same envelope:
//   - an plugin's frame (ui part) and the host bridge in the app window: postMessage, every message tagged with the protocol and
//     checked against the frame it came from;
//   - an plugin's node part and the broker in the agent server: one JSON message per line over a local socket, authenticated
//     with a credential made for that one plugin (never the server's token);
//   - the broker and the host bridge, for capabilities only one side has (the designs, the reports, the chat live in the window;
//     files, git, programs, the network and the model live in the server): the same envelope, wrapped in a relay message.
// The part that is called checks the plugin's grants itself (see `isAllowed`); a caller's claim of what it may do is never used.

export const RPC_PROTOCOL = 'subtubes-plugin' as const

export const RPC_ERROR_CODES = [
  'unknown-method',
  'wrong-part',
  'invalid-params',
  // The plugin does not have the permission the call needs (`needs` says which).
  'not-granted',
  // The person said no (a write, a design change).
  'declined',
  'rate-limited',
  'too-large',
  'timeout',
  // The thing is not there to use: no project open, no server, no model chosen, the program is not installed.
  'unavailable',
  // The plugin is disabled or stopped.
  'not-running',
  'failed',
] as const

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number]

export const rpcErrorSchema = z.object({
  code: z.enum(RPC_ERROR_CODES),
  // For the plugin's author, and for the log: what happened and what to do.
  message: z.string().max(2000),
  // For "not-granted": the permission that was missing.
  needs: z.string().optional(),
})

const callId = z.string().min(1).max(64)

export const rpcRequestSchema = z.object({
  protocol: z.literal(RPC_PROTOCOL),
  kind: z.literal('request'),
  id: callId,
  method: z.string().min(1).max(64),
  params: z.unknown().optional(),
})

export const rpcResponseSchema = z.discriminatedUnion('ok', [
  z.object({ protocol: z.literal(RPC_PROTOCOL), kind: z.literal('response'), id: callId, ok: z.literal(true), result: z.unknown() }),
  z.object({ protocol: z.literal(RPC_PROTOCOL), kind: z.literal('response'), id: callId, ok: z.literal(false), error: rpcErrorSchema }),
])

// A one-way notice that needs no answer: "lifecycle.deactivate" is a request (it waits), a log line is an event.
export const rpcEventSchema = z.object({
  protocol: z.literal(RPC_PROTOCOL),
  kind: z.literal('event'),
  name: z.string().min(1).max(64),
  data: z.unknown().optional(),
})

export const rpcMessageSchema = z.union([rpcRequestSchema, rpcResponseSchema, rpcEventSchema])

export type RpcRequest = z.infer<typeof rpcRequestSchema>
export type RpcResponse = z.infer<typeof rpcResponseSchema>
export type RpcEvent = z.infer<typeof rpcEventSchema>
export type RpcMessage = z.infer<typeof rpcMessageSchema>
export type RpcError = z.infer<typeof rpcErrorSchema>

// ---- between the broker and the window ----

const relayId = z.string().min(1).max(64)

// The broker asks the window to do something only the window can (create a report, propose a design change), on behalf of an
// plugin. The window checks the grants again.
export const relayRequestSchema = z.object({
  kind: z.literal('relay-request'),
  relayId,
  pluginId: z.string().min(1).max(64),
  part: z.enum(['ui', 'node']),
  method: z.string().min(1).max(64),
  params: z.unknown().optional(),
})

export const relayResponseSchema = z.discriminatedUnion('ok', [
  z.object({ kind: z.literal('relay-response'), relayId, ok: z.literal(true), result: z.unknown() }),
  z.object({ kind: z.literal('relay-response'), relayId, ok: z.literal(false), error: rpcErrorSchema }),
])

export type RelayRequest = z.infer<typeof relayRequestSchema>
export type RelayResponse = z.infer<typeof relayResponseSchema>

// ---- what the app keeps about an installed plugin ----

// The app, not the plugin, keeps this. It is what both the window and the broker check a call against.
export const installedPluginSchema = z.object({
  id: z.string(),
  version: z.string(),
  // Where it was loaded from, for reloading during development.
  folder: z.string(),
  enabled: z.boolean(),
  // The permission texts the person agreed to: a subset of what the manifest asked for.
  grants: z.array(z.string()),
  // A hash of the manifest at the time of agreeing. A changed manifest that asks for more is not enabled until it is agreed to again.
  manifestHash: z.string(),
  installedAt: z.number(),
})

export type InstalledPlugin = z.infer<typeof installedPluginSchema>

// Whether an updated manifest may keep running on the grants it already has: it must not ask for anything it was not given.
export function needsReapproval(granted: readonly string[], asked: readonly string[]): string[] {
  return asked.filter((permission) => !granted.includes(permission))
}
