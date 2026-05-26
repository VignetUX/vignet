import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import { resolve } from 'path'
import { startJibeServer } from '../node/server.js'

// Resolve vitest from the consumer project so workers find their own deps (e.g. jsdom)
const consumerRequire = createRequire(resolve(process.cwd(), 'package.json'))
const vitestNodePath = consumerRequire.resolve('vitest/node')
const { createVitest } = await import(pathToFileURL(vitestNodePath).href)

const configIndex = process.argv.indexOf('--config')
const configFile = configIndex !== -1
  ? resolve(process.cwd(), process.argv[configIndex + 1])
  : undefined

const vitest = await createVitest('test', { watch: true, ...(configFile && { config: configFile }) })
await startJibeServer(vitest)