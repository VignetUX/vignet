import 'vitest'

declare module 'vitest' {
  interface TaskMeta {
    jibe?: { name?: string }
  }
}
