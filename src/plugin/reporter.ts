import type { Reporter } from 'vitest'
import type { WebSocket } from 'ws'

interface TestInfo {
  name: string
}

interface FileInfo {
  filepath: string
  tests: TestInfo[]
}

function flattenTasks(tasks: any[]): TestInfo[] {
  return (tasks ?? []).flatMap((t: any) => {
    if (t.type === 'test' || t.type === 'custom') return [{ name: t.name }]
    if (t.type === 'suite' && t.tasks) return flattenTasks(t.tasks)
    return []
  })
}

export class WorkshopReporter implements Reporter {
  readonly clients = new Set<WebSocket>()

  addClient(ws: WebSocket) {
    this.clients.add(ws)
    ws.on('close', () => this.clients.delete(ws))
  }

  private broadcast(data: object) {
    const json = JSON.stringify(data)
    for (const client of this.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(json)
      }
    }
  }

  onCollected(files?: any[]) {
    if (!files?.length) return
    const payload: FileInfo[] = files.map((f: any) => ({
      filepath: f.filepath,
      tests: flattenTasks(f.tasks ?? []),
    }))
    this.broadcast({ type: 'collected', files: payload })
  }

  onFinished() {
    this.broadcast({ type: 'finished' })
  }
}
