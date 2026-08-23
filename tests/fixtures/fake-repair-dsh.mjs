import { readFileSync } from 'node:fs'
import http from 'node:http'

const entryId = 'plugin:web:e2e-conflict'
const packageName = '@e2e/dsh-conflict'
const patchIndex = process.argv.indexOf('--patch')

if (process.argv.includes('--version')) {
  console.log('0.0.3')
  process.exit(0)
}

if (patchIndex >= 0) {
  const patch = JSON.parse(readFileSync(process.argv[patchIndex + 1], 'utf8'))
  if (!Array.isArray(patch) || !patch.some((item) => item?.id === entryId && item?.disabled === true)) {
    console.error('Error: E2E repair overlay did not disable the expected plugin')
    process.exit(31)
  }
}

if (process.argv.includes('--dump-config')) {
  console.log(`- id: ${entryId}\n  name: ${packageName}`)
  process.exit(0)
}

if (patchIndex < 0) {
  console.error(`Error: duplicate entry id "${entryId}" from package "${packageName}"`)
  process.exit(1)
}

const server = http.createServer((_request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end('<!doctype html><title>DeepSeek Harness E2E</title><script>window.__DSH_BOOT__={ repaired: true }</script>ok')
})
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (typeof address === 'object' && address) console.log(`dsh web: http://127.0.0.1:${address.port}`)
})
process.on('SIGTERM', () => server.close(() => process.exit(0)))
