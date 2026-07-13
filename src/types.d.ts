import 'vitest'

declare module 'vitest' {
  interface TaskMeta {
    vignet?: { name?: string }
  }
}
