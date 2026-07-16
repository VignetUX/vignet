import { loadConfigFromFile } from 'vite'
import { existsSync } from 'fs'
import { join } from 'path'

const CONFIG_NAMES = ['vitest.config', 'vite.config']
const CONFIG_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']

// Load a consumer's Vite-compatible config file and return only the parts that are safe to
// forward: plugins (e.g. vite-tsconfig-paths, custom resolvers) and resolve config (aliases).
// We deliberately do NOT forward server, base, appType, build, etc. — those settings
// control how the consumer's app is served and would break vignet's own server if inherited.
export async function loadConsumerPluginsAndResolve(
  root: string,
  configFile?: string,
): Promise<{ plugins: any[]; resolve: any }> {
  try {
    const result = await loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile, root)
    return {
      // Flatten in case any plugin entry is itself an array (Vite allows nested plugin arrays)
      plugins: (result?.config?.plugins ?? []).flat().filter(Boolean),
      resolve: result?.config?.resolve ?? {},
    }
  } catch {
    return { plugins: [], resolve: {} }
  }
}

// Vite's loadConfigFromFile only auto-discovers vite.config.*, never vitest.config.* — but many
// consumers (especially Next.js apps with no reason to keep a vite.config.ts) define their
// Vite-compatible config, including alias-resolving plugins, only in vitest.config.ts. This
// mirrors vitest's own CONFIG_NAMES/CONFIG_EXTENSIONS search order (vitest.config.* preferred
// over vite.config.*) for callers that have no live Vitest instance to ask directly.
export function findConsumerConfigFile(root: string): string | undefined {
  for (const name of CONFIG_NAMES) {
    for (const ext of CONFIG_EXTENSIONS) {
      const candidate = join(root, name + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}
