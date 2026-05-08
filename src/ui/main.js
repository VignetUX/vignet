// Workshop orchestrator UI — injected into the Vitest orchestrator page.
// Runs as a <script type="module"> after orchestrator.ts, so
// window.__vitest_browser_runner__.orchestrator is already set.

const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
const ws = new WebSocket(`${protocol}//${location.host}/__workshop_api__`)

injectStyles()
buildLayout()

let sidebarPopulated = false
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.type === 'collected' && !sidebarPopulated) {
    sidebarPopulated = true
    renderFileTree(msg.files)
  }
})

ws.addEventListener('error', () => {
  console.warn('[workshop] WebSocket to /__workshop_api__ failed — is the plugin loaded?')
})

// Intercept the initial Vitest auto-run and change it to collect-only so nothing
// renders on load. The orchestrator is registered synchronously by orchestrator.ts,
// which runs after this module (both are type="module" deferred, in DOM order).
// setTimeout(0) fires after orchestrator.ts has run, but before the Node process
// can send the first run command (network round-trip is slower than a macrotask).
setTimeout(() => {
  const runner = window.__vitest_browser_runner__
  const orchestrator = runner?.orchestrator
  if (!orchestrator) return

  const orig = orchestrator.createTesters.bind(orchestrator)
  let initialRunDone = false
  orchestrator.createTesters = async (options) => {
    if (!initialRunDone) {
      initialRunDone = true
      return orig({ ...options, method: 'collect' })
    }
    return orig(options)
  }
}, 0)

// ─── Layout ──────────────────────────────────────────────────────────────────

function injectStyles() {
  const style = document.createElement('style')
  style.textContent = `
    html, body {
      margin: 0; padding: 0; height: 100%; overflow: hidden;
    }
    body {
      display: flex; flex-direction: row;
    }
    #__workshop_sidebar__ {
      width: 260px;
      min-width: 260px;
      height: 100%;
      overflow-y: auto;
      background: #111;
      color: #ccc;
      font-family: ui-monospace, 'Cascadia Code', 'Menlo', monospace;
      font-size: 12px;
      box-sizing: border-box;
      border-right: 1px solid #2a2a2a;
      display: flex;
      flex-direction: column;
    }
    #__workshop_sidebar__ h1 {
      margin: 0;
      padding: 12px 16px;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      border-bottom: 1px solid #2a2a2a;
      letter-spacing: 0.4px;
    }
    #__workshop_list__ {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }
    .ws-file {
      padding: 10px 16px 4px;
      font-size: 10px;
      font-weight: 600;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      user-select: none;
    }
    .ws-variant {
      padding: 5px 16px 5px 24px;
      cursor: pointer;
      color: #aaa;
      border-left: 2px solid transparent;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color 0.1s;
    }
    .ws-variant:hover {
      color: #e0e0e0;
      background: #1a1a1a;
    }
    .ws-variant.active {
      color: #fff;
      border-left-color: #4d8fff;
      background: #132030;
    }
    #vitest-tester {
      flex: 1;
      height: 100%;
      overflow: auto;
      background: #fff;
    }
    #vitest-tester iframe[data-vitest] {
      display: block;
    }
  `
  document.head.appendChild(style)
}

function buildLayout() {
  const sidebar = document.createElement('aside')
  sidebar.id = '__workshop_sidebar__'

  const heading = document.createElement('h1')
  heading.textContent = 'Workshop'
  sidebar.appendChild(heading)

  const list = document.createElement('div')
  list.id = '__workshop_list__'
  sidebar.appendChild(list)

  // Prepend sidebar so it appears before #vitest-tester
  document.body.insertBefore(sidebar, document.body.firstChild)
}

// ─── Variant list ─────────────────────────────────────────────────────────────

function renderFileTree(files) {
  const list = document.getElementById('__workshop_list__')
  if (!list) return
  list.innerHTML = ''

  for (const { filepath, tests } of files) {
    if (!tests.length) continue

    const filename = filepath.split('/').pop() ?? filepath

    const fileEl = document.createElement('div')
    fileEl.className = 'ws-file'
    fileEl.title = filepath
    fileEl.textContent = filename
    list.appendChild(fileEl)

    for (const { name } of tests) {
      const variantEl = document.createElement('div')
      variantEl.className = 'ws-variant'
      variantEl.textContent = name
      variantEl.title = name
      variantEl.addEventListener('click', () => {
        selectVariant(variantEl, filepath, name)
      })
      list.appendChild(variantEl)
    }
  }
}

function selectVariant(el, filepath, testName) {
  // Deselect all
  document.querySelectorAll('.ws-variant.active').forEach(v => v.classList.remove('active'))
  el.classList.add('active')
  runVariant(filepath, testName)
}

// ─── Test execution ───────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function runVariant(filepath, testName) {
  const runner = window.__vitest_browser_runner__
  if (!runner) {
    console.warn('[workshop] __vitest_browser_runner__ not available yet')
    return
  }
  const orchestrator = runner.orchestrator
  if (!orchestrator) {
    console.warn('[workshop] orchestrator not registered yet')
    return
  }

  // testNamePattern uses $ anchor only (no ^) because getTaskFullName() prepends
  // a space for top-level tests: `" primary"`. The $ anchor is sufficient to
  // uniquely identify the variant while tolerating the leading space.
  orchestrator.createTesters({
    files: [{ filepath, testNamePattern: new RegExp(escapeRegex(testName) + '$') }],
    method: 'run',
    providedContext: runner.providedContext ?? '[{}]',
  }).catch((err) => {
    console.error('[workshop] createTesters failed:', err)
  })
}
