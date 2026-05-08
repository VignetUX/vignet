const sidebar = document.getElementById('sidebar-content')!
const iframe = document.getElementById('workshop-frame') as HTMLIFrameElement

interface TestEntry { name: string; index: number }

let currentFile = ''
let currentRun = -1

function renderSidebar(fileGroups: Record<string, TestEntry[]>) {
  sidebar.innerHTML = ''
  for (const [file, tests] of Object.entries(fileGroups)) {
    const group = document.createElement('div')
    group.className = 'file-group'

    const label = document.createElement('div')
    label.className = 'file-label'
    label.textContent = file.replace(/^\/src\//, '')
    group.appendChild(label)

    for (const t of tests) {
      const btn = document.createElement('button')
      btn.className = 'test-item'
      btn.textContent = t.name
      btn.dataset.file = file
      btn.dataset.index = String(t.index)
      btn.addEventListener('click', () => selectTest(file, t.index, btn))
      group.appendChild(btn)
    }

    sidebar.appendChild(group)
  }
}

function selectTest(file: string, index: number, btn: HTMLButtonElement) {
  document.querySelectorAll('.test-item').forEach(el => el.classList.remove('active'))
  btn.classList.add('active')
  currentFile = file
  currentRun = index
  iframe.src = `/frame.html?file=${encodeURIComponent(file)}&run=${index}`
}

window.addEventListener('message', (event) => {
  if (event.source !== iframe.contentWindow) return
  const msg = event.data
  if (msg?.type !== 'tests_collected') return

  const tests: TestEntry[] = msg.tests
  const groups: Record<string, TestEntry[]> = {}
  groups[currentFile] = tests
  renderSidebar(groups)

  // Restore active state after re-render
  if (currentRun >= 0) {
    const btns = sidebar.querySelectorAll<HTMLButtonElement>('.test-item')
    btns.forEach(btn => {
      if (btn.dataset.file === currentFile && Number(btn.dataset.index) === currentRun) {
        btn.classList.add('active')
      }
    })
  }
})

async function init() {
  const res = await fetch('/__workshop_files__')
  const { files }: { files: string[] } = await res.json()

  if (files.length === 0) {
    sidebar.innerHTML = '<p id="sidebar-empty">No test files found.</p>'
    return
  }

  // Load the first file into the iframe and wait for tests_collected
  currentFile = files[0]
  iframe.src = `/frame.html?file=${encodeURIComponent(files[0])}`

  // Render placeholder sidebar entries so user sees file names
  const placeholders: Record<string, TestEntry[]> = {}
  for (const f of files) placeholders[f] = []
  renderSidebar(placeholders)
}

init()
