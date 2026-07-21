import { useEffect, useState } from 'react'
import * as Switch from '@radix-ui/react-switch'
import type { ParamSchemaEntry } from '../runtime'
import vignetIcon from './assets/vignet-icon.png'

declare const __VIGNET_BUILD_MODE__: boolean | undefined

interface Test {
  name: string
  displayName?: string
  index: number
}

interface ManifestEntry {
  path: string
  bundle: string
  views: string[]
}

function fileLabel(filePath: string): string {
  return filePath.replace(/.*\//, '').replace(/\.test\.[tj]sx?$/, '')
}

const isBuildMode = typeof __VIGNET_BUILD_MODE__ !== 'undefined' && __VIGNET_BUILD_MODE__

// Encodes param values into URL-safe p.* query/hash params.
function encodeParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params)
  if (entries.length === 0) return ''
  return entries
    .map(([k, v]) => `p.${encodeURIComponent(k)}=${encodeURIComponent(JSON.stringify(v))}`)
    .join('&')
}

// JSON textarea control with local state so in-progress edits aren't clobbered.
function JsonParamControl({ entry, value, onUpdate }: {
  entry: ParamSchemaEntry
  value: unknown
  onUpdate: (key: string, value: unknown, navigate: boolean) => void
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [invalid, setInvalid] = useState(false)

  // Reset when the resolved value changes externally (e.g. view switch resets to default).
  const serialized = JSON.stringify(value)
  useEffect(() => {
    setText(JSON.stringify(value, null, 2))
    setInvalid(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized])

  return (
    <div className="vg-field">
      <label className="vg-field-label">{entry.label}</label>
      <textarea
        className={`vg-json${invalid ? ' is-invalid' : ''}`}
        value={text}
        rows={4}
        onChange={e => {
          setText(e.target.value)
          try {
            onUpdate(entry.key, JSON.parse(e.target.value), true)
            setInvalid(false)
          } catch {
            setInvalid(true)
          }
        }}
      />
    </div>
  )
}

function ParamControl({ entry, value, onUpdate }: {
  entry: ParamSchemaEntry
  value: unknown
  onUpdate: (key: string, value: unknown, navigate: boolean) => void
}) {
  if (entry.control === 'json') {
    return <JsonParamControl entry={entry} value={value} onUpdate={onUpdate} />
  }

  return (
    <div className="vg-field">
      <label className="vg-field-label">{entry.label}</label>
      {entry.control === 'text' && (
        <input
          type="text"
          className="vg-input vg-input-text"
          value={String(value ?? '')}
          onChange={e => onUpdate(entry.key, e.target.value, false)}
          onBlur={e => onUpdate(entry.key, e.target.value, true)}
          onKeyDown={e => {
            if (e.key === 'Enter') onUpdate(entry.key, (e.target as HTMLInputElement).value, true)
          }}
        />
      )}
      {entry.control === 'number' && (
        <input
          type="number"
          className="vg-input vg-input-number"
          value={Number(value ?? 0)}
          onChange={e => onUpdate(entry.key, Number(e.target.value), true)}
        />
      )}
      {entry.control === 'range' && (
        <div className="vg-range-row">
          <input
            type="range"
            min={entry.min}
            max={entry.max}
            step={entry.step}
            value={Number(value ?? entry.min ?? 0)}
            onChange={e => onUpdate(entry.key, Number(e.target.value), true)}
          />
          <span className="vg-range-value">{String(value)}</span>
        </div>
      )}
      {entry.control === 'boolean' && (
        <Switch.Root
          className="vg-switch-root"
          checked={Boolean(value)}
          onCheckedChange={checked => onUpdate(entry.key, checked, true)}
        >
          <Switch.Thumb className="vg-switch-thumb" />
        </Switch.Root>
      )}
      {entry.control === 'select' && (
        <select
          className="vg-input vg-select"
          value={JSON.stringify(value)}
          onChange={e => {
            try { onUpdate(entry.key, JSON.parse(e.target.value), true) }
            catch { onUpdate(entry.key, e.target.value, true) }
          }}
        >
          {entry.options?.map(opt => (
            <option key={JSON.stringify(opt)} value={JSON.stringify(opt)}>{String(opt)}</option>
          ))}
        </select>
      )}
    </div>
  )
}

export function App() {
  const [frameSrc, setFrameSrc] = useState('')
  const [frameKey, setFrameKey] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [bundleMap, setBundleMap] = useState<Record<string, string>>({})
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [tests, setTests] = useState<Test[]>([])
  const [selectedRun, setSelectedRun] = useState<number | null>(null)
  const [paramSchema, setParamSchema] = useState<ParamSchemaEntry[]>([])
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({})
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [frameError, setFrameError] = useState<{ context: string; message: string; stack?: string } | null>(null)

  useEffect(() => {
    if (isBuildMode) {
      fetch('./manifest.json')
        .then(r => r.json())
        .then(({ files: entries }: { files: ManifestEntry[] }) => {
          const map: Record<string, string> = {}
          for (const e of entries) map[e.path] = e.bundle
          setFiles(entries.map(e => e.path))
          setBundleMap(map)
        })
    } else {
      fetch('/__workshop_files__')
        .then(r => r.json())
        .then(({ files }: { files: string[] }) => setFiles(files))
    }
  }, [])

  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.data?.type === 'tests_collected') {
        setFrameError(null)
        setTests(e.data.tests)
      } else if (e.data?.type === 'workshop_error') {
        setFrameError({ context: e.data.context, message: e.data.message, stack: e.data.stack })
      } else if (e.data?.type === 'param_schema') {
        const schema: ParamSchemaEntry[] = e.data.schema ?? []
        setParamSchema(schema)
        // Initialize only new keys — preserve values already set by the user.
        setParamValues(prev => {
          const next: Record<string, unknown> = {}
          for (const s of schema) {
            next[s.key] = s.key in prev ? prev[s.key] : s.defaultValue
          }
          return next
        })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  function frameUrl(file: string, run: number, pValues: Record<string, unknown>): string {
    const paramStr = encodeParams(pValues)
    if (isBuildMode) {
      const bundle = bundleMap[file]
      const hash = `bundle=${encodeURIComponent(bundle)}&run=${run}${paramStr ? '&' + paramStr : ''}`
      return `./frame.html#${hash}`
    }
    return `/frame?file=${encodeURIComponent(file)}&run=${run}${paramStr ? '&' + paramStr : ''}`
  }

  // In build mode every URL is `./frame.html#...` — same path, only the hash fragment
  // changes between selections. Browsers treat an iframe.src reassignment that differs
  // only by fragment as an in-page hash change, not a navigation, so frame-static.ts's
  // top-level script (which reads location.hash once on load) never re-runs. Bumping
  // frameKey forces React to unmount/remount the iframe element, which always produces
  // a real navigation regardless of whether the URL's path or only its hash changed.
  function navigateFrame(url: string) {
    setFrameSrc(url)
    setFrameKey(k => k + 1)
  }

  function selectFile(file: string) {
    setSelectedFile(file)
    setTests([])
    setSelectedRun(0)
    setParamSchema([])
    setParamValues({})
    setFrameError(null)
    navigateFrame(frameUrl(file, 0, {}))
  }

  function selectTest(index: number) {
    setSelectedRun(index)
    setParamSchema([])
    setParamValues({})
    setFrameError(null)
    if (selectedFile) {
      navigateFrame(frameUrl(selectedFile, index, {}))
    }
  }

  // Updates a single param value and optionally reloads the iframe.
  // Text inputs pass navigate=false on every keystroke, then true on blur/Enter.
  // All other controls pass navigate=true immediately.
  function updateParam(key: string, value: unknown, navigate: boolean) {
    const newValues = { ...paramValues, [key]: value }
    setParamValues(newValues)
    if (navigate && selectedFile !== null && selectedRun !== null) {
      navigateFrame(frameUrl(selectedFile, selectedRun, newValues))
    }
  }

  return (
    <div className="vg-app">
      {!isFullscreen && (
        <div className="vg-topbar">
          <div className="vg-brand">
            <div className="vg-brand-mark">
              <img src={vignetIcon} alt="Vignet" />
            </div>
            <div className="vg-brand-text">vignet</div>
          </div>
          <button type="button" className="vg-fullscreen-btn" title="Fullscreen" onClick={() => setIsFullscreen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          </button>
        </div>
      )}
      <div className="vg-body">
        {!isFullscreen && (
          <div className="vg-sidebar">
            <div className="vg-sidebar-scroll">
              {files.map(file => (
                <div key={file}>
                  <div
                    className={`vg-file-row${selectedFile === file ? ' is-selected' : ''}`}
                    onClick={() => selectFile(file)}
                  >
                    {fileLabel(file)}
                  </div>
                  {selectedFile === file && tests.map(test => (
                    <div
                      key={test.index}
                      className={`vg-variant-row${selectedRun === test.index ? ' is-selected' : ''}`}
                      onClick={() => selectTest(test.index)}
                    >
                      <span className="vg-variant-dot" />
                      <span>{test.displayName ?? test.name}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="vg-main">
          {isFullscreen && (
            <button type="button" className="vg-exit-fullscreen-btn" onClick={() => setIsFullscreen(false)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
              </svg>
              <span>Exit fullscreen</span>
            </button>
          )}
          <div className="vg-canvas">
            <iframe key={frameKey} src={frameSrc} />
            {frameError && (
              <div className="vg-error-panel">
                <div className="vg-error-context">{frameError.context}</div>
                <div className="vg-error-message">{frameError.message}</div>
                {frameError.stack && <pre className="vg-error-stack">{frameError.stack}</pre>}
              </div>
            )}
          </div>
          {paramSchema.length > 0 && (
            <div className="vg-controls">
              {paramSchema.map(s => (
                <ParamControl key={s.key} entry={s} value={paramValues[s.key]} onUpdate={updateParam} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
