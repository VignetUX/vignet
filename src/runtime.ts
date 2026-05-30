export interface ParamOptions {
  label?: string
  options?: unknown[]
  min?: number
  max?: number
  step?: number
}

export interface ParamSchemaEntry {
  key: string
  label: string
  defaultValue: unknown
  control: 'text' | 'number' | 'range' | 'boolean' | 'select' | 'json'
  options?: unknown[]
  min?: number
  max?: number
  step?: number
}

function inferControl(defaultValue: unknown, opts?: ParamOptions): ParamSchemaEntry['control'] {
  if (opts?.options) return 'select'
  if (typeof defaultValue === 'boolean') return 'boolean'
  if (typeof defaultValue === 'number') {
    return opts?.min !== undefined || opts?.max !== undefined ? 'range' : 'number'
  }
  if (typeof defaultValue === 'string') return 'text'
  return 'json'
}

export function param<T>(key: string, defaultValue: T, opts?: ParamOptions): T {
  const schema: ParamSchemaEntry[] | undefined = (window as any).__workshop_param_schema__
  if (schema && !schema.some(s => s.key === key)) {
    const control = inferControl(defaultValue, opts)
    const entry: ParamSchemaEntry = { key, label: opts?.label ?? key, defaultValue, control }
    if (opts?.options !== undefined) entry.options = opts.options
    if (opts?.min !== undefined) entry.min = opts.min
    if (opts?.max !== undefined) entry.max = opts.max
    if (opts?.step !== undefined) entry.step = opts.step
    schema.push(entry)
  }
  const p = (window as any).__workshop_params__
  return p && key in p ? (p[key] as T) : defaultValue
}
