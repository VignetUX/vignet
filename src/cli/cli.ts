import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import { resolve } from 'path'

// Resolve vitest from the consumer project so workers find their own deps (e.g. jsdom)
const consumerRequire = createRequire(resolve(process.cwd(), 'package.json'))
const vitestNodePath = consumerRequire.resolve('vitest/node')
const { startVitest } = await import(pathToFileURL(vitestNodePath).href)

await startVitest('test')