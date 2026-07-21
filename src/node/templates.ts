// Inlined as a data: URI (rather than a served static asset) since the dev server's
// custom middleware doesn't expose a public/ directory, and the build output's asset
// path would need separate threading through the build-mode template too.
const FAVICON_DATA_URI = 'data:image/png;base64,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'

// HTML shell for the static build's main workshop page.
export function workshopBuildHtml(uiJsPath: string, uiCssPath?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" href="${FAVICON_DATA_URI}" />
    ${uiCssPath ? `<link rel="stylesheet" href="${uiCssPath}" />` : ''}
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
  <head>
    <meta charset="UTF-8" />
    <title>Vignet Frame</title>
    <style>html, body { margin: 0; background: transparent; }</style>
  </head>
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
  <head>
    <meta charset="UTF-8" />
    <title>Vignet Frame</title>
    <style>html, body { margin: 0; background: transparent; }</style>
  </head>
  <body><script type="module" src="/@fs${frameEntry}"></script></body>
</html>`
}

// uiJsPath/uiCssPath point at the pre-built UI shell (see scripts/build-ui.ts), served
// as static files by vignet:server's /__vignet_ui__/ middleware — not live-transformed,
// so no @vitejs/plugin-react/react/react-dom is required in the consumer's project.
export function workshopHtml(uiJsPath: string, uiCssPath?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" href="${FAVICON_DATA_URI}" />
    ${uiCssPath ? `<link rel="stylesheet" href="${uiCssPath}" />` : ''}
    <title>Vignet Workshop</title>
  </head>
  <body>
    <div id="root"></div>
    <script>
      // dynamicImportPlugin wraps all import() calls with __vitest_mocker__.wrapDynamicImport.
      // The mocker is only active in the test iframe, so provide a passthrough here.
      if (!window["__vitest_mocker__"]) window["__vitest_mocker__"] = { wrapDynamicImport: fn => fn() };
    </script>
    <script type="module" src="${uiJsPath}"></script>
  </body>
</html>`
}
