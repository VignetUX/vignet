# Jibe vitest prototype

## Building and running

For active CLI development, run pnpm dev (tsup --watch) in root — it rebuilds dist/cli.js automatically on every save. Then each pnpm jibe in example picks up the latest build instantly.

To get a clean build via tsup, you pass --clean on the CLI or clean: true in the config.