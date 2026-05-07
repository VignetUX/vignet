import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'

let _root: ReturnType<typeof createRoot> | null = null

export async function workshopMount(element: ReactElement): Promise<void> {
  // When the workshop sidebar drives test runs, __workshop_selected_variant__ is set
  // on the tester window. Skip rendering for any test that isn't the selected variant.
  const selected: string | undefined = (window as any).__workshop_selected_variant__
  if (selected !== undefined) {
    const currentName: string | undefined = (window as any).__vitest_worker__?.current?.name
    if (currentName != null && currentName !== selected) return
  }

  let container = document.getElementById('__workshop_root__')
  if (!container) {
    container = document.createElement('div')
    container.id = '__workshop_root__'
    container.style.cssText = 'width:100%;height:100%;'
    document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;'
    document.body.appendChild(container)
  }
  if (_root) {
    _root.unmount()
    _root = null
  }
  _root = createRoot(container)
  _root.render(element)
}
