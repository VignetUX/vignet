import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { FrameworkAdapter } from './types.js'

// Cheap, reliable Angular signal: an angular.json with a project wired to the Vitest-based
// unit-test builder. This avoids invoking Angular's Architect builder just to ask "are you
// Angular" — and avoids false positives on hybrid repos that have @angular/core installed
// but still run plain Karma/Jasmine tests.
async function detect(cwd: string): Promise<boolean> {
  const angularJsonPath = path.join(cwd, 'angular.json')
  if (!existsSync(angularJsonPath)) return false
  try {
    const angularJson = JSON.parse(await readFile(angularJsonPath, 'utf-8'))
    const projects = Object.values(angularJson.projects ?? {}) as any[]
    return projects.some(project => project?.architect?.test?.builder === '@angular/build:unit-test')
  } catch {
    return false
  }
}

function consumerHasPackage(cwd: string, pkg: string): boolean {
  try {
    createRequire(path.resolve(cwd, 'package.json')).resolve(pkg)
    return true
  } catch {
    return false
  }
}

// This is the minimal, documented, stable public API surface for TestBed initialization —
// not a reverse-engineered copy of Angular CLI's generated init-testbed.js virtual module
// (see docs/framework-setup-adapters.md for why that module can't be reused directly).
//
// Uses bare specifiers rather than pre-resolved absolute paths deliberately: the file this
// source is written to (see resolve() below) lives inside the consumer's own project tree,
// so Vite resolves these through its normal pipeline — the same resolution + optimizeDeps
// path button.spec.ts (or any other spec) already goes through. Resolving '@angular/core/testing'
// to a hand-picked absolute path (e.g. straight into the pnpm store) would produce a *second*,
// differently-identified module instance, and Angular's TestBed keeps its "have I been
// initialized" state on that module instance — so specs importing the normally-resolved copy
// would still see "Need to call TestBed.initTestEnvironment() first".
function buildSetupSource(cwd: string): string {
  // zone.js is a peer dependency of @angular/core, not guaranteed to be present (some newer
  // Angular apps opt into zoneless change detection) — only import it if both its main entry
  // and its /testing subpath actually resolve, so zoneless projects don't get a hard failure.
  const hasZone = consumerHasPackage(cwd, 'zone.js') && consumerHasPackage(cwd, 'zone.js/testing')
  const zoneImports = hasZone ? `import 'zone.js'\nimport 'zone.js/testing'\n` : ''
  return (
    zoneImports +
    `import { TestBed } from '@angular/core/testing'
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing'

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting())
`
  )
}

// Writes the generated setup module inside the consumer's own project tree (under
// node_modules/, alongside other tool-generated caches) rather than an OS temp directory —
// see buildSetupSource's comment for why file location determines module identity here.
// Returned as a root-relative URL rather than an /@fs path since the file already lives
// under Vite's root and needs no filesystem escape hatch to be served.
async function resolve(cwd: string): Promise<{ setupFiles: string[] }> {
  const dir = path.join(cwd, 'node_modules', '.vignet-adapters')
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, 'angular-testbed-init.mjs')
  await writeFile(filePath, buildSetupSource(cwd), 'utf-8')
  return { setupFiles: ['/' + path.relative(cwd, filePath).replaceAll(path.sep, '/')] }
}

export const angularAdapter: FrameworkAdapter = { name: 'angular', detect, resolve }
