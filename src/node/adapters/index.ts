import { angularAdapter } from './angular.js'
import type { FrameworkAdapter } from './types.js'

// Registered in priority order. Only the first matching adapter applies — a project's test
// bootstrapping is owned by one framework, not several at once.
const adapters: FrameworkAdapter[] = [angularAdapter]

// Runs detect() over the registered adapters and returns the first match's resolved setup
// files, or an empty list if no adapter applies (the common case — plain Vitest consumers
// are already fully covered by Tier 1's generic setupFiles execution).
export async function resolveFrameworkAdapterEnv(cwd: string): Promise<{ setupFiles: string[] }> {
  for (const adapter of adapters) {
    if (await adapter.detect(cwd)) return adapter.resolve(cwd)
  }
  return { setupFiles: [] }
}
