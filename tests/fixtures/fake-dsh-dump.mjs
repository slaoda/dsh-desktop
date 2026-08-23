if (!process.argv.includes('--dump-config')) process.exit(12)

console.log(`# effective config
- id: github-tools
  name: '@example/dsh-github'
- id: local-tool
  name: ./local.ts
`)
