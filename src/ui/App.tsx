import { useRef } from 'react'

export function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  function runTest() {
    if (iframeRef.current) {
      iframeRef.current.src = '/frame?file=/src/Button.test.tsx&run=0'
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div>
        <h1>Jibe Workshop</h1>
        <button onClick={runTest}>Render: Button / primary</button>
      </div>
      <iframe ref={iframeRef} style={{ flex: 1, border: 'none' }} />
    </div>
  )
}
