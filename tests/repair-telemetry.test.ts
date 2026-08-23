import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiagnosticLogger } from '../src/main/diagnostic-logger'
import { repairDiagnosticRecord } from '../src/main/repair/repair-telemetry'
import type { RepairSessionSummary } from '../src/shared/contracts'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

function session(): RepairSessionSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111', phase: 'failed', outcome: 'failed',
    diagnosis: {
      category: 'plugin-conflict', confidence: 'high',
      summary: 'password=do-not-log', evidence: ['Authorization: Bearer token-value'],
      candidate: { entryId: 'plugin:web:test', packageName: '@scope/plugin' },
      action: { kind: 'quarantine-plugin', entryId: 'plugin:web:test', packageName: '@scope/plugin', reversible: true, requiresConfirmation: false }
    },
    actions: [{ kind: 'quarantine-plugin', target: 'plugin:web:test', status: 'rolled-back', summary: 'token=another-secret' }],
    repairAttempts: 1, retryAttempts: 1, quarantinedPlugin: null
  }
}

describe('repair telemetry', () => {
  it('把状态转换为稳定事件名和最小字段', () => {
    const record = repairDiagnosticRecord(session(), '0.1.1-rc.2', false)

    expect(record).toMatchObject({
      level: 'error', event: 'repair-rolled-back',
      data: {
        repairId: '11111111-1111-4111-8111-111111111111', version: '0.1.1-rc.2', external: false,
        category: 'plugin-conflict', repairAttempts: 1, retryAttempts: 1
      }
    })
    expect(record.data).not.toHaveProperty('environment')
    expect(record.data).not.toHaveProperty('configuration')
  })

  it('落盘前再次移除修复摘要中的认证信息', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-repair-telemetry-'))
    const logger = new DiagnosticLogger(directory)
    const record = repairDiagnosticRecord(session(), '0.1.1-rc.2', false)

    await logger.log(record.level, record.event, record.data)
    const content = await readFile(logger.file, 'utf8')
    expect(content).not.toContain('do-not-log')
    expect(content).not.toContain('token-value')
    expect(content).not.toContain('another-secret')
    expect(content).toContain('[REDACTED]')
  })
})
