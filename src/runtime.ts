export function param<T>(key: string, defaultValue: T): T {
  const p = (window as any).__workshop_params__
  return p && key in p ? p[key] : defaultValue
}
