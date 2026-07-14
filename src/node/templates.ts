// Inlined as a data: URI (rather than a served static asset) since the dev server's
// custom middleware doesn't expose a public/ directory, and the build output's asset
// path would need separate threading through the build-mode template too.
const FAVICON_DATA_URI = 'data:image/png;base64,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'

// HTML shell for the static build's main workshop page.
export function workshopBuildHtml(uiJsPath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" href="${FAVICON_DATA_URI}" />
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
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" href="${FAVICON_DATA_URI}" />
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
