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
  private _lastCollected: FileInfo[] | null = null

  addClient(ws: WebSocket) {
    this.clients.add(ws)
    ws.on('close', () => this.clients.delete(ws))
    // Replay last collected data so clients that connect after onCollected fires still get it
    if (this._lastCollected) {
      ws.send(JSON.stringify({ type: 'collected', files: this._lastCollected }))
    }
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
    })).filter(f => f.tests.length > 0)
    if (!payload.length) return
    this._lastCollected = payload
    this.broadcast({ type: 'collected', files: payload })
  }

  onFinished() {
    this.broadcast({ type: 'finished' })
  }
}
