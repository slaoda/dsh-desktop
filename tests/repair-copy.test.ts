import { describe, expect, it } from 'vitest'
import { formatRepairReport } from '../src/renderer/repair-report'
import type { AppSnapshot } from '../src/shared/contracts'

function snapshot(): AppSnapshot {
  return {
    appVersion: '0.2.0', locale: 'zh-CN', localePreference: 'system', releaseChannel: 'all',
    registryUrl: 'https://registry.npmjs.org', harnessHome: null, backups: [], externalInstallations: [],
    closeToTray: true, startAtLogin: false, proxyMode: 'system', manualProxyUrl: null, repairMode: 'auto',
    nodeVersion: 'v22.19.0', latestVersion: null, selectedVersion: '0.1.1-rc.2', selectedExternalId: null,
    dismissedLatest: null, installedVersions: [], availableVersions: [], runtimeStatus: 'failed', runtimeUrl: null,
    repairSession: {
      id: '11111111-1111-4111-8111-111111111111', phase: 'failed', outcome: 'failed',
      diagnosis: {
        category: 'plugin-conflict', confidence: 'high', summary: '插件启动失败 password=super-secret',
        evidence: ['Authorization: Bearer abc.def.ghi', 'plugin:web:github'],
        candidate: { entryId: 'plugin:web:github', packageName: '@example/dsh-github' },
        action: { kind: 'quarantine-plugin', entryId: 'plugin:web:github', packageName: '@example/dsh-github', reversible: true, requiresConfirmation: false }
      },
      actions: [{ kind: 'quarantine-plugin', target: 'plugin:web:github', status: 'rolled-back', summary: '已回滚' }],
      repairAttempts: 1, retryAttempts: 1, quarantinedPlugin: null
    },
    error: 'https://user:password@example.test/?token=another-secret'
  }
}

describe('startup repair report', () => {
  it('只输出受控修复字段并再次脱敏', () => {
    const report = formatRepairReport(snapshot())

    expect(report).toContain('repairId: 11111111-1111-4111-8111-111111111111')
    expect(report).toContain('category: plugin-conflict')
    expect(report).toContain('plugin:web:github')
    expect(report).toContain('[REDACTED]')
    expect(report).not.toContain('super-secret')
    expect(report).not.toContain('abc.def.ghi')
    expect(report).not.toContain('another-secret')
    expect(report.length).toBeLessThanOrEqual(4_096)
  })

  it('没有修复会话时生成最小诊断报告', () => {
    const value = snapshot()
    value.repairSession = null
    value.error = null

    expect(formatRepairReport(value)).toContain('repairSession: none')
  })
})
