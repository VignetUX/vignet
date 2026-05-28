export function frameHtml(frameEntry: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Jibe Frame</title></head>
  <body><script type="module" src="/@fs${frameEntry}"></script></body>
</html>`
}

export function workshopHtml(mainEntry: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Jibe Workshop</title>
  </head>
  <body>
    <div id="root"></div>
    <script>
      // dynamicImportPlugin wraps all import() calls with __vitest_mocker__.wrapDynamicImport.
      // The mocker is only active in the test iframe, so provide a passthrough here.
      if (!window["__vitest_mocker__"]) window["__vitest_mocker__"] = { wrapDynamicImport: fn => fn() };
    </script>
    <script type="module" src="/@fs${mainEntry}"></script>
  </body>
</html>`
}
