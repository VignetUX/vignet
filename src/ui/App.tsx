import { useEffect, useRef, useState } from 'react'
import type { ParamSchemaEntry } from '../runtime'

declare const __JIBE_BUILD_MODE__: boolean | undefined

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

const isBuildMode = typeof __JIBE_BUILD_MODE__ !== 'undefined' && __JIBE_BUILD_MODE__

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {entry.label}
      </label>
      <textarea
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
        style={{
          fontFamily: 'monospace',
          fontSize: 11,
          width: 200,
          border: `1px solid ${invalid ? '#e53935' : '#ccc'}`,
          borderRadius: 4,
          padding: '4px 6px',
          resize: 'vertical',
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
  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 4,
  }
  const inputStyle: React.CSSProperties = {
    fontSize: 13,
    border: '1px solid #ccc',
    borderRadius: 4,
    padding: '3px 6px',
  }

  if (entry.control === 'json') {
    return <JsonParamControl entry={entry} value={value} onUpdate={onUpdate} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={labelStyle}>{entry.label}</label>
      {entry.control === 'text' && (
        <input
          type="text"
          value={String(value ?? '')}
          style={{ ...inputStyle, width: 160 }}
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
          value={Number(value ?? 0)}
          style={{ ...inputStyle, width: 80 }}
          onChange={e => onUpdate(entry.key, Number(e.target.value), true)}
        />
      )}
      {entry.control === 'range' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={entry.min}
            max={entry.max}
            step={entry.step}
            value={Number(value ?? entry.min ?? 0)}
            onChange={e => onUpdate(entry.key, Number(e.target.value), true)}
          />
          <span style={{ fontSize: 12, color: '#333', minWidth: 32 }}>{String(value)}</span>
        </div>
      )}
      {entry.control === 'boolean' && (
        <input
          type="checkbox"
          checked={Boolean(value)}
          style={{ width: 16, height: 16, cursor: 'pointer' }}
          onChange={e => onUpdate(entry.key, e.target.checked, true)}
        />
      )}
      {entry.control === 'select' && (
        <select
          value={JSON.stringify(value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
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
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [files, setFiles] = useState<string[]>([])
  const [bundleMap, setBundleMap] = useState<Record<string, string>>({})
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [tests, setTests] = useState<Test[]>([])
  const [selectedRun, setSelectedRun] = useState<number | null>(null)
  const [paramSchema, setParamSchema] = useState<ParamSchemaEntry[]>([])
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({})

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
        setTests(e.data.tests)
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

  function selectFile(file: string) {
    setSelectedFile(file)
    setTests([])
    setSelectedRun(0)
    setParamSchema([])
    setParamValues({})
    if (iframeRef.current) {
      iframeRef.current.src = frameUrl(file, 0, {})
    }
  }

  function selectTest(index: number) {
    setSelectedRun(index)
    setParamSchema([])
    setParamValues({})
    if (iframeRef.current && selectedFile) {
      iframeRef.current.src = frameUrl(selectedFile, index, {})
    }
  }

  // Updates a single param value and optionally reloads the iframe.
  // Text inputs pass navigate=false on every keystroke, then true on blur/Enter.
  // All other controls pass navigate=true immediately.
  function updateParam(key: string, value: unknown, navigate: boolean) {
    const newValues = { ...paramValues, [key]: value }
    setParamValues(newValues)
    if (navigate && iframeRef.current && selectedFile !== null && selectedRun !== null) {
      iframeRef.current.src = frameUrl(selectedFile, selectedRun, newValues)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #e0e0e0', background: '#fff' }}>
        <strong>Jibe Workshop</strong>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: 220, borderRight: '1px solid #e0e0e0', overflowY: 'auto', background: '#fafafa' }}>
          {files.map(file => (
            <div key={file}>
              <div
                onClick={() => selectFile(file)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 13,
                  background: selectedFile === file ? '#e8f0fe' : 'transparent',
                  color: selectedFile === file ? '#1a73e8' : '#333',
                }}
              >
                {fileLabel(file)}
              </div>
              {selectedFile === file && tests.map(test => (
                <div
                  key={test.index}
                  onClick={() => selectTest(test.index)}
                  style={{
                    padding: '6px 12px 6px 24px',
                    cursor: 'pointer',
                    fontSize: 12,
                    background: selectedRun === test.index ? '#e8f0fe' : 'transparent',
                    color: selectedRun === test.index ? '#1a73e8' : '#555',
                  }}
                >
                  {test.displayName ?? test.name}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <iframe ref={iframeRef} style={{ flex: 1, border: 'none', minHeight: 0 }} />
          {paramSchema.length > 0 && (
            <div style={{
              borderTop: '1px solid #e0e0e0',
              background: '#fafafa',
              padding: '12px 16px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 20,
              alignItems: 'flex-start',
              maxHeight: 220,
              overflowY: 'auto',
            }}>
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
