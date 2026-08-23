import { describe, expect, it } from 'vitest'
import { diagnoseStartupFailure, mayAutoRepair } from '../src/main/repair/repair-diagnosis'

describe('diagnoseStartupFailure', () => {
  it('只对明确指出 entry id 的托管插件冲突给出高置信度隔离动作', () => {
    const diagnosis = diagnoseStartupFailure({
      message: 'Error: dsh: duplicate entry id "github-tools" while loading plugin @example/dsh-github',
      source: 'installed',
      version: '0.1.0-rc.8'
    })

    expect(diagnosis).toMatchObject({
      category: 'plugin-conflict',
      confidence: 'high',
      candidate: { entryId: 'github-tools', packageName: '@example/dsh-github' },
      action: {
        kind: 'quarantine-plugin',
        entryId: 'github-tools',
        packageName: '@example/dsh-github',
        reversible: true,
        requiresConfirmation: false
      }
    })
  })

  it('插件错误没有唯一 entry id 时只诊断不自动隔离', () => {
    const diagnosis = diagnoseStartupFailure({
      message: 'Error: dsh: plugin tree failed to load: service shell already has another provider',
      source: 'bundled',
      version: '0.1.0-rc.8'
    })

    expect(diagnosis).toMatchObject({ category: 'plugin-conflict', confidence: 'medium', action: null })
  })

  it('从 from package 错误格式提取真实包名而不是关键字', () => {
    const diagnosis = diagnoseStartupFailure({
      message: 'Error: duplicate entry id "plugin:web:e2e-conflict" from package "@e2e/dsh-conflict"',
      source: 'installed',
      version: '0.1.0-rc.8'
    })

    expect(diagnosis.candidate).toMatchObject({
      entryId: 'plugin:web:e2e-conflict',
      packageName: '@e2e/dsh-conflict'
    })
  })

  it('缺失第三方包归类为插件缺失但不会猜测修复动作', () => {
    const diagnosis = diagnoseStartupFailure({
      message: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@example/dsh-calendar' imported from C:\\Users\\example\\.dsh\\profiles\\web",
      source: 'installed',
      version: '0.1.0-rc.8'
    })

    expect(diagnosis).toMatchObject({
      category: 'plugin-missing',
      confidence: 'medium',
      candidate: { packageName: '@example/dsh-calendar' },
      action: null
    })
  })

  it('凭据或环境配置错误永远不会生成修复动作且摘要会脱敏', () => {
    const diagnosis = diagnoseStartupFailure({
      message: 'Error: .credentials.yaml is invalid; API_KEY=sk-do-not-copy',
      source: 'installed',
      version: '0.1.0-rc.8'
    })

    expect(diagnosis).toMatchObject({ category: 'sensitive-config', confidence: 'high', action: null })
    expect(diagnosis.summary).not.toContain('sk-do-not-copy')
    expect(diagnosis.evidence.join(' ')).not.toContain('sk-do-not-copy')
  })

  it('外部安装即使出现明确插件冲突也只报告不写入', () => {
    const diagnosis = diagnoseStartupFailure({
      message: 'Error: duplicate entry id "github-tools" from @example/dsh-github',
      source: 'external',
      version: '0.1.0-rc.8'
    })

    expect(diagnosis).toMatchObject({ category: 'external-installation', confidence: 'high', action: null })
  })

  it('托管 CLI 入口损坏时只建议重装同一精确版本', () => {
    const diagnosis = diagnoseStartupFailure({
      message: '官方 DSH CLI 入口无效',
      source: 'installed',
      version: '0.1.0-rc.8'
    })

    expect(diagnosis).toMatchObject({
      category: 'managed-install-corrupt',
      confidence: 'high',
      action: {
        kind: 'reinstall-managed-version',
        version: '0.1.0-rc.8',
        reversible: true,
        requiresConfirmation: false
      }
    })
  })

  it('托管包清单身份或 bin 校验失败时也只建议原版本重装', () => {
    for (const message of ['官方 DSH 包身份或版本校验失败', '官方 DSH 包未提供 dsh CLI 入口']) {
      expect(diagnoseStartupFailure({ message, source: 'installed', version: '0.1.0-rc.8' })).toMatchObject({
        category: 'managed-install-corrupt', confidence: 'high',
        action: { kind: 'reinstall-managed-version', version: '0.1.0-rc.8' }
      })
    }
  })

  it('未知错误保持低置信度且不修复', () => {
    const diagnosis = diagnoseStartupFailure({ message: 'something unexpected happened', source: 'installed', version: '0.1.0-rc.8' })
    expect(diagnosis).toMatchObject({ category: 'unknown', confidence: 'low', action: null })
  })
})

describe('mayAutoRepair', () => {
  const highConfidenceRepair = diagnoseStartupFailure({
    message: 'Error: duplicate entry id "github-tools" from @example/dsh-github',
    source: 'installed',
    version: '0.1.0-rc.8'
  })

  it('只允许 auto 模式执行高置信度、可回滚且无需确认的动作', () => {
    expect(mayAutoRepair(highConfidenceRepair, 'auto')).toBe(true)
    expect(mayAutoRepair(highConfidenceRepair, 'ask')).toBe(false)
    expect(mayAutoRepair(highConfidenceRepair, 'diagnose')).toBe(false)
  })

  it('没有动作的诊断永远不能自动修复', () => {
    const unknown = diagnoseStartupFailure({ message: 'unknown', source: 'installed', version: '0.1.0-rc.8' })
    expect(mayAutoRepair(unknown, 'auto')).toBe(false)
  })
})
