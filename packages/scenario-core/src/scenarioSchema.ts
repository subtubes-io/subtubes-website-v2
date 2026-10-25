import { z } from 'zod'

// The shape of a scenario: a scripted walk through a design's diagram. It is the one definition used by the scenario
// file format (src/simulation/schema.ts) and by the createScenario tool, so what the assistant is told to write and
// what the app accepts cannot drift apart. The descriptions are what the model reads.

const idSchema = z.string().min(1)
const primitive = z.union([z.string(), z.number(), z.boolean()])
const pathSchema = z
  .string()
  .regex(/^(input|state)\.[\w]+$/, 'Use input.<name> or state.<name>')
  .describe('Where to read a value: "input.<name>" is something the user entered; "state.<name>" is something an earlier step set.')
const outcomeSchema = z.enum(['success', 'failure', 'blocked'])

export type ScenarioCondition =
  | { all: ScenarioCondition[] }
  | { any: ScenarioCondition[] }
  | { not: ScenarioCondition }
  | { path: string; op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'truthy'; value?: string | number | boolean | (string | number | boolean)[] }

export const conditionSchema: z.ZodType<ScenarioCondition> = z
  .lazy(() =>
    z.union([
      z.strictObject({ all: z.array(conditionSchema) }),
      z.strictObject({ any: z.array(conditionSchema) }),
      z.strictObject({ not: conditionSchema }),
      z.strictObject({
        path: pathSchema,
        op: z
          .enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'truthy'])
          .describe('"eq"/"ne" compare for equality; "gt"/"gte"/"lt"/"lte" compare numbers; "in" needs a list as value; "contains" is a case-insensitive text match; "truthy" needs no value.'),
        value: z.union([primitive, z.array(primitive)]).optional(),
      }),
    ]),
  )
  .describe('A test on the input or the run state. Combine tests with {all:[...]}, {any:[...]} or {not:...}.')

const endSchema = z
  .strictObject({
    outcome: outcomeSchema.describe('How the run ended: "success", "failure" (something went wrong), or "blocked" (it was refused or had to stop).'),
    message: z.string().min(1).describe('One sentence saying what happened. May use {{input.x}} and {{state.x}}.'),
  })
  .describe('Ends the run here.')

const effectSchema = z
  .union([
    z.strictObject({ set: idSchema, value: primitive }),
    z.strictObject({ set: idSchema, add: z.number() }),
    z.strictObject({
      set: idSchema,
      derive: z.strictObject({
        from: pathSchema,
        rules: z.array(z.strictObject({ contains: z.array(z.string().min(1)).min(1), value: primitive })).describe('Tried in order; the first whose words appear in the text wins.'),
        default: primitive,
      }),
      ai: z.boolean().optional().describe('Mark the result as something the assistant would work out, in the display.'),
    }),
  ])
  .describe('Changes the run state when the step happens. {set, value} stores a value (text may use {{input.x}}/{{state.x}}); {set, add} adds to a number; {set, derive} reads free text and picks a value by keyword.')

const transitionSchema = z
  .strictObject({
    to: idSchema.optional().describe('The id of the next step (a key of "steps").'),
    end: endSchema.optional(),
    when: conditionSchema.optional().describe('Take this branch only if the condition holds. Branches are tried in order, so put a branch with no "when" last as the fallback.'),
    label: z.string().optional().describe('A short label for the branch, shown where the choice was made.'),
  })
  .refine((t) => (t.to !== undefined) !== (t.end !== undefined), 'A branch needs exactly one of "to" or "end"')
  .describe('A way forward from a step: either "to" another step, or "end" the run.')

const stepSchema = z
  .strictObject({
    node: idSchema.describe('The id of the diagram node where this step happens. Use ids from getDiagram, never titles.'),
    title: z.string().min(1).describe('What happens here, as a short sentence. May use {{input.x}} and {{state.x}}.'),
    detail: z.string().optional(),
    effects: z.array(effectSchema).optional(),
    calls: z
      .array(
        z.strictObject({
          to: idSchema.describe('The id of a diagram node that this node calls and gets an answer from straight away (a lookup, a tool). Ideally an edge goes from this node to it.'),
          title: z.string().min(1),
          detail: z.string().optional(),
          when: conditionSchema.optional(),
        }),
      )
      .optional()
      .describe('Side trips to other nodes that return immediately; they show on the diagram but do not move the flow.'),
    next: z.array(transitionSchema).optional().describe('Where to go after this step. With none (and no "end"), the run ends as a success.'),
    end: endSchema.optional().describe('Ends the run at this step, instead of "next".'),
  })
  .describe('One step of the scenario, at one diagram node.')

const inputSchema = z.strictObject({
  name: z.string().regex(/^\w+$/).describe('The name used in "input.<name>" and {{input.<name>}}. Letters, digits and underscore.'),
  label: z.string().min(1).describe('What the person sees next to the field.'),
  type: z.enum(['text', 'number', 'boolean', 'select']),
  default: primitive.describe('The value used when the person does not change it. Must suit the type.'),
  options: z.array(z.string()).optional().describe('The choices, for type "select".'),
  help: z.string().optional(),
  fromChat: z.boolean().optional().describe('Fill this field from what the person wrote in the chat when the scenario is proposed.'),
})

export const scenarioSchema = z
  .strictObject({
    id: idSchema.describe('A short unique id, lowercase with dashes, for example "refund-declined". Not already used by another scenario in the design.'),
    title: z.string().min(1).describe('The name shown in the scenario list.'),
    description: z.string().describe('One or two sentences on what the scenario shows.'),
    triggers: z.array(z.string().min(1)).optional().describe('Words that make the chat suggest this scenario.'),
    inputs: z.array(inputSchema).describe('What the person can vary before a run. May be empty.'),
    presets: z.array(z.strictObject({ name: z.string().min(1), values: z.record(z.string(), primitive) })).optional().describe('Named sets of input values, for quick choices.'),
    initialState: z.record(z.string(), primitive).optional().describe('Starting values of the run state, read as "state.<name>".'),
    start: idSchema.describe('The id of the first step: a key of "steps".'),
    steps: z.record(z.string(), stepSchema).describe('The steps, by id. Branches and "start" refer to these ids.'),
  })
  .superRefine((scenario, ctx) => {
    const ids = new Set(Object.keys(scenario.steps))
    if (!ids.has(scenario.start)) {
      ctx.addIssue({ code: 'custom', path: ['start'], message: `Start step "${scenario.start}" is not defined` })
    }
    for (const [stepId, step] of Object.entries(scenario.steps)) {
      step.next?.forEach((t, i) => {
        if (t.to !== undefined && !ids.has(t.to)) {
          ctx.addIssue({ code: 'custom', path: ['steps', stepId, 'next', i, 'to'], message: `Unknown step "${t.to}"` })
        }
      })
    }
  })
  .describe('A scripted walk through the design: steps at diagram nodes, joined by branches, ending with an outcome.')

export type ScenarioDraft = z.infer<typeof scenarioSchema>
