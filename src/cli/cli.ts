import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import { resolve } from 'path'
import cac from 'cac'
import { buildWorkshop } from '../node/build.js'

const cli = cac('vignet')

cli
  .command('build', 'Build a static deployable workshop')
  .option('--out <dir>', 'Output directory', { default: 'workshop-dist' })
  .action(async (options: { out: string }) => {
    await buildWorkshop(process.cwd(), options.out)
  })

cli
  .command('dev', 'Start the workshop dev server')
  .option('--config <file>', 'Path to vitest config file')
  .action(async (options: { config?: string }) => {
    await startDevServer(options.config)
  })

// Default command (bare `vignet` with no subcommand) starts the dev server
cli
  .command('', 'Start the workshop dev server')
  .option('--config <file>', 'Path to vitest config file')
  .action(async (options: { config?: string }) => {
    await startDevServer(options.config)
  })

cli.help()
cli.version('0.0.1')
cli.parse()

async function startDevServer(configFile?: string): Promise<void> {
  const { startVignetServer } = await import('../node/server.js')

  // Resolve vitest from the consumer project so workers find their own deps (e.g. jsdom)
  const consumerRequire = createRequire(resolve(process.cwd(), 'package.json'))
  const vitestNodePath = consumerRequire.resolve('vitest/node')
  const { createVitest } = await import(pathToFileURL(vitestNodePath).href)

  const resolvedConfig = configFile ? resolve(process.cwd(), configFile) : undefined
  const vitest = await createVitest('test', { watch: true, ...(resolvedConfig && { config: resolvedConfig }) })
  await startVignetServer(vitest)
}
