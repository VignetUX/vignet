// HTML shell for the static build's main workshop page.
export function workshopBuildHtml(uiJsPath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Vignet Workshop</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${uiJsPath}"></script>
  </body>
</html>`
}

// HTML shell for the static build's iframe. References the pre-built frame-static bundle.
export function frameBuildHtml(frameJsPath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Vignet Frame</title></head>
  <body>
    <script>
      // Node.js globals are not available in browsers. Test bundles include packages like
      // React and @testing-library that reference process.env.*. We polyfill process here
      // rather than replacing references at build time so that React loads its test/development
      // build (not the production build), which is required for act() and render() to work.
      globalThis.process = { env: { NODE_ENV: "test" }, versions: {}, version: "" };
    </script>
    <script type="module" src="${frameJsPath}"></script>
  </body>
</html>`
}

export function frameHtml(frameEntry: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Vignet Frame</title></head>
  <body><script type="module" src="/@fs${frameEntry}"></script></body>
</html>`
}

export function workshopHtml(mainEntry: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Vignet Workshop</title>
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
