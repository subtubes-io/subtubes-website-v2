import type { Condition, Primitive, Values } from './types'

export interface Scope {
  input: Values
  state: Values
}

export function resolvePath(scope: Scope, path: string): Primitive | undefined {
  const [root, ...rest] = path.split('.')
  const key = rest.join('.')
  if (root === 'input') return scope.input[key]
  if (root === 'state') return scope.state[key]
  return undefined
}

function compare(op: string, left: Primitive | undefined, right: Primitive | Primitive[] | undefined): boolean {
  switch (op) {
    case 'truthy':
      return Boolean(left)
    case 'eq':
      return left === right
    case 'ne':
      return left !== right
    case 'gt':
      return Number(left) > Number(right)
    case 'gte':
      return Number(left) >= Number(right)
    case 'lt':
      return Number(left) < Number(right)
    case 'lte':
      return Number(left) <= Number(right)
    case 'in':
      return Array.isArray(right) && left !== undefined && right.includes(left)
    case 'contains':
      return typeof right === 'string' && String(left ?? '').toLowerCase().includes(right.toLowerCase())
    default:
      return false
  }
}

export function evaluate(condition: Condition, scope: Scope): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluate(c, scope))
  if ('any' in condition) return condition.any.some((c) => evaluate(c, scope))
  if ('not' in condition) return !evaluate(condition.not, scope)
  return compare(condition.op, resolvePath(scope, condition.path), condition.value)
}

function show(value: Primitive | Primitive[] | undefined): string {
  if (Array.isArray(value)) return `[${value.map(show).join(', ')}]`
  return typeof value === 'string' ? `“${value}”` : String(value)
}

const OP_TEXT: Record<string, string> = {
  eq: 'is',
  ne: 'is not',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: 'is one of',
  contains: 'contains',
}

// Human-readable form of a condition, used to label branches that have no label.
export function describeCondition(condition: Condition): string {
  if ('all' in condition) return condition.all.map(describeCondition).join(' and ')
  if ('any' in condition) return condition.any.map(describeCondition).join(' or ')
  if ('not' in condition) return `not (${describeCondition(condition.not)})`
  const name = condition.path.split('.').slice(1).join('.')
  if (condition.op === 'truthy') return `${name} is on`
  return `${name} ${OP_TEXT[condition.op]} ${show(condition.value)}`
}

// Replaces {{input.x}} and {{state.x}}; unknown paths become empty text.
export function interpolate(text: string, scope: Scope): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => String(resolvePath(scope, path) ?? ''))
}
