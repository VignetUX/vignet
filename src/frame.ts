declare global {
  interface Window {
    __workshop_registry__: Array<{ name: string; fn: () => Promise<void> | void }>
    __workshop_params__: Record<string, unknown>
  }
}

window.__workshop_registry__ = []
window.__workshop_params__ = {}

const params = new URLSearchParams(location.search)
const file = params.get('file')
const runParam = params.get('run')

if (!file) {
  throw new Error('Workshop frame: missing ?file= param')
}

;(async () => {
  await import(/* @vite-ignore */ file)

  const tests = window.__workshop_registry__.map((t, i) => ({ name: t.name, index: i }))
  window.parent.postMessage({ type: 'tests_collected', tests }, '*')

  if (runParam !== null) {
    const index = parseInt(runParam, 10)
    const entry = window.__workshop_registry__[index]
    if (entry) {
      await entry.fn()
    }
  }
})()
