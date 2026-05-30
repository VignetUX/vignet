import { useEffect, useRef, useState } from 'react'

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

export function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [files, setFiles] = useState<string[]>([])
  const [bundleMap, setBundleMap] = useState<Record<string, string>>({})
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [tests, setTests] = useState<Test[]>([])
  const [selectedRun, setSelectedRun] = useState<number | null>(null)

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
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  function frameUrl(file: string, run: number): string {
    if (isBuildMode) {
      const bundle = bundleMap[file]
      // Params go in the hash so they survive clean-URL redirects (frame.html → frame).
      return `./frame.html#bundle=${encodeURIComponent(bundle)}&run=${run}`
    }
    return `/frame?file=${encodeURIComponent(file)}&run=${run}`
  }

  function selectFile(file: string) {
    setSelectedFile(file)
    setTests([])
    setSelectedRun(0)
    if (iframeRef.current) {
      iframeRef.current.src = frameUrl(file, 0)
    }
  }

  function selectTest(index: number) {
    setSelectedRun(index)
    if (iframeRef.current && selectedFile) {
      iframeRef.current.src = frameUrl(selectedFile, index)
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
        <iframe ref={iframeRef} style={{ flex: 1, border: 'none' }} />
      </div>
    </div>
  )
}
