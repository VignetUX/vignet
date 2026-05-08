import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import type { IncomingMessage } from 'node:http'
import { WorkshopReporter } from './reporter.js'

const uiScript = readFileSync(
  fileURLToPath(new URL('../ui/main.js', import.meta.url)),
  'utf-8',
)

export function workshopPlugin(): Plugin {
  const reporter = new WorkshopReporter()

  return {
    name: 'vitest-workshop',

    config() {
      return {
        test: {
          browser: {
            ui: false,
            isolate: true,
            orchestratorScripts: [{ content: uiScript }],
          },
        },
      } as any
    },

    // configResolved runs after Vite resolves the full config. We add the reporter
    // instance here — it can't be returned from config() since it's a class instance.
    configResolved(resolvedConfig: any) {
      // Vitest stores its final merged options in resolvedConfig._vitest.
      // If that's already been set (Vitest's configResolved ran first), mutate it directly.
      // Otherwise fall back to resolvedConfig.test (our configResolved ran first).
      const target = resolvedConfig._vitest ?? resolvedConfig.test
      if (!target) return

      if (!target.reporters) {
        target.reporters = ['default', reporter]
      } else if (Array.isArray(target.reporters)) {
        if (!target.reporters.includes(reporter)) target.reporters.push(reporter)
      } else {
        target.reporters = [target.reporters, reporter]
      }

      // If _vitest was already set, also try to patch resolvedConfig.test so that
      // whichever path Vitest uses to build project.config picks it up.
      if (resolvedConfig._vitest && resolvedConfig.test) {
        const raw = resolvedConfig.test
        if (!raw.reporters) {
          raw.reporters = ['default', reporter]
        } else if (Array.isArray(raw.reporters) && !raw.reporters.includes(reporter)) {
          raw.reporters.push(reporter)
        }
      }
    },

    configureServer(server) {
      // WebSocket hub: Node reporter → browser UI
      import('ws').then(({ WebSocketServer }) => {
        const wss = new WebSocketServer({ noServer: true })

        server.httpServer?.on('upgrade', (req: IncomingMessage, socket, head) => {
          const url = new URL(req.url ?? '', 'http://localhost')
          if (url.pathname !== '/__workshop_api__') return
          wss.handleUpgrade(req, socket as any, head, (ws) => {
            reporter.addClient(ws as any)
          })
        })
      })
    },
  }
}
