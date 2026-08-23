import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiagnosticLogger, redactDiagnostic } from '../src/main/diagnostic-logger'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('DiagnosticLogger', () => {
  it('隐藏 API Key、令牌、密码和 URL 认证信息', () => {
    const value = 'DEEPSEEK_API_KEY=sk-secret123 proxy=http://alice:p4ss@proxy.test TOKEN=abc123 password: hunter2 url=https://example.test/?access_token=query-secret'
    const redacted = redactDiagnostic(value)
    expect(redacted).not.toContain('sk-secret123')
    expect(redacted).not.toContain('p4ss')
    expect(redacted).not.toContain('abc123')
    expect(redacted).not.toContain('hunter2')
    expect(redacted).not.toContain('query-secret')
    expect(redacted).toContain('[REDACTED]')
  })

  it('串行写入结构化日志且不会保存敏感值', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-logs-'))
    const logger = new DiagnosticLogger(directory)
    await Promise.all([
      logger.log('info', 'initialized', { version: '1.0.0' }),
      logger.log('error', 'launch-failed', {
        message: 'API_KEY=sk-do-not-save',
        token: 'plain-token-value',
        apiKey: 'plain-api-key',
        authorization: 'Bearer plain-authorization'
      })
    ])
    const content = await readFile(logger.file, 'utf8')
    expect(content).toContain('initialized')
    expect(content).toContain('launch-failed')
    expect(content).not.toContain('sk-do-not-save')
    expect(content).not.toContain('plain-token-value')
    expect(content).not.toContain('plain-api-key')
    expect(content).not.toContain('plain-authorization')
  })
})
