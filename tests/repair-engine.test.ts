import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ResolvedDsh } from '../src/main/version-manager'
import { RepairBaselineStore } from '../src/main/repair/repair-baseline'
import { PluginQuarantineStore } from '../src/main/repair/plugin-quarantine'
import { RepairEngine, RepairLaunchError } from '../src/main/repair/repair-engine'
import { RepairTransactionStore } from '../src/main/repair/repair-transaction'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

async function createFixture(source: ResolvedDsh['source'] = 'installed'): Promise<{
  dsh: ResolvedDsh
  baselines: RepairBaselineStore
  quarantine: PluginQuarantineStore
  transactions: RepairTransactionStore
}> {
  directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-repair-engine-'))
  const userData = path.join(directory, 'desktop')
  const harnessHome = path.join(directory, '.dsh')
  const profile = path.join(harnessHome, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: { '@example/dsh-github': '1.2.3' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@example/dsh-github'] } }
  }))
  await writeFile(path.join(profile, 'cordis.patch.yml'), '[]\n')
  await writeFile(path.join(harnessHome, 'cordis.patch.yml'), '[]\n')
  return {
    dsh: { version: '0.1.0-rc.8', root: path.join(directory, 'managed'), entry: path.join(directory, 'managed', 'cli.js'), source },
    baselines: new RepairBaselineStore(userData, harnessHome),
    quarantine: new PluginQuarantineStore(userData),
    transactions: new RepairTransactionStore(userData)
  }
}

function passingPreflight() {
  return {
    inspect: async (dsh: ResolvedDsh, overlay: string | null) => dsh.source === 'external'
      ? { status: 'skipped' as const, effectiveConfig: null, entries: [] }
      : {
          status: 'passed' as const,
          effectiveConfig: overlay ? '- id: github-tools\n  disabled: true\n' : '- id: github-tools\n  name: @example/dsh-github\n',
          entries: [{ entryId: 'github-tools', packageName: '@example/dsh-github' }]
        }
  }
}

describe('RepairEngine', () => {
  it('明确插件冲突时备份、隔离并只重试一次', async () => {
    const fixture = await createFixture()
    const overlays: Array<string | null> = []
    let starts = 0
    const supervisor = {
      start: async (_dsh: ResolvedDsh, options?: { repairOverlay?: string | null }) => {
        starts += 1
        overlays.push(options?.repairOverlay ?? null)
        if (starts === 1) throw new Error('Error: duplicate entry id "github-tools" from @example/dsh-github')
        return 'http://127.0.0.1:43123'
      }
    }
    const backupCalls: Array<[string, string]> = []
    const engine = new RepairEngine({
      supervisor,
      preflight: passingPreflight(),
      baselines: fixture.baselines,
      quarantine: fixture.quarantine,
      transactions: fixture.transactions,
      backups: {
        hasSource: async () => true,
        create: async (reason, scope) => { backupCalls.push([reason, scope]) }
      }
    })

    const result = await engine.launch(fixture.dsh, 'auto')

    expect(result.url).toBe('http://127.0.0.1:43123')
    expect(result.session).toMatchObject({
      phase: 'recovered', outcome: 'recovered', repairAttempts: 1, retryAttempts: 1,
      diagnosis: { category: 'plugin-conflict', confidence: 'high' },
      quarantinedPlugin: { entryId: 'github-tools', packageName: '@example/dsh-github', disposition: 'pending' }
    })
    expect(result.session.actions).toEqual([expect.objectContaining({ kind: 'quarantine-plugin', status: 'applied', target: 'github-tools' })])
    expect(backupCalls).toEqual([['pre-repair', 'configuration']])
    expect(overlays).toEqual([null, fixture.quarantine.overlayFile])
    expect(await fixture.transactions.read()).toBeNull()
    expect(await fixture.quarantine.list()).toHaveLength(1)
    expect(await fixture.baselines.read()).toMatchObject({ version: '0.1.0-rc.8' })
  })

  it('修复后重试仍失败时回滚隔离并停止', async () => {
    const fixture = await createFixture()
    let starts = 0
    const engine = new RepairEngine({
      supervisor: {
        start: async () => {
          starts += 1
          if (starts === 1) throw new Error('Error: duplicate entry id "github-tools" from @example/dsh-github')
          throw new Error('Error: plugin github-tools still failed')
        }
      },
      preflight: passingPreflight(), baselines: fixture.baselines,
      quarantine: fixture.quarantine, transactions: fixture.transactions,
      backups: { hasSource: async () => true, create: async () => undefined }
    })

    let failure: RepairLaunchError | null = null
    try { await engine.launch(fixture.dsh, 'auto') } catch (error) { failure = error as RepairLaunchError }

    expect(failure).toBeInstanceOf(RepairLaunchError)
    expect(failure?.session).toMatchObject({ phase: 'failed', outcome: 'failed', repairAttempts: 1, retryAttempts: 1 })
    expect(failure?.session.actions).toEqual([expect.objectContaining({ kind: 'quarantine-plugin', status: 'rolled-back' })])
    expect(starts).toBe(2)
    expect(await fixture.quarantine.list()).toEqual([])
    expect(await fixture.transactions.read()).toBeNull()
  })

  it('未知错误不备份、不修改并且不重试', async () => {
    const fixture = await createFixture()
    let starts = 0
    let backups = 0
    const engine = new RepairEngine({
      supervisor: { start: async () => { starts += 1; throw new Error('unexpected boot failure') } },
      preflight: passingPreflight(), baselines: fixture.baselines,
      quarantine: fixture.quarantine, transactions: fixture.transactions,
      backups: { hasSource: async () => true, create: async () => { backups += 1 } }
    })

    await expect(engine.launch(fixture.dsh, 'auto')).rejects.toMatchObject({
      session: { phase: 'failed', diagnosis: { category: 'unknown' }, repairAttempts: 0, retryAttempts: 0 }
    })
    expect(starts).toBe(1)
    expect(backups).toBe(0)
    expect(await fixture.quarantine.list()).toEqual([])
  })

  it('外部安装失败只诊断且不进行体检写入或修复', async () => {
    const fixture = await createFixture('external')
    let starts = 0
    let backups = 0
    const engine = new RepairEngine({
      supervisor: { start: async () => { starts += 1; throw new Error('Error: duplicate entry id "github-tools" from @example/dsh-github') } },
      preflight: passingPreflight(), baselines: fixture.baselines,
      quarantine: fixture.quarantine, transactions: fixture.transactions,
      backups: { hasSource: async () => true, create: async () => { backups += 1 } }
    })

    await expect(engine.launch(fixture.dsh, 'auto')).rejects.toMatchObject({
      session: { diagnosis: { category: 'external-installation', action: null }, repairAttempts: 0, retryAttempts: 0 }
    })
    expect(starts).toBe(1)
    expect(backups).toBe(0)
    expect(await fixture.baselines.read()).toBeNull()
  })

  it('没有故障时保存基线但不显示为已修复', async () => {
    const fixture = await createFixture()
    const engine = new RepairEngine({
      supervisor: { start: async () => 'http://127.0.0.1:43123' },
      preflight: passingPreflight(), baselines: fixture.baselines,
      quarantine: fixture.quarantine, transactions: fixture.transactions,
      backups: { hasSource: async () => true, create: async () => undefined }
    })

    const result = await engine.launch(fixture.dsh, 'auto')
    expect(result.session).toMatchObject({ phase: 'completed', outcome: 'not-needed', diagnosis: null, repairAttempts: 0, retryAttempts: 0 })
    expect(await fixture.baselines.read()).toMatchObject({ version: '0.1.0-rc.8' })
  })

  it('解析托管版本失败时只重装同一版本并在验证后提交', async () => {
    const fixture = await createFixture()
    let commits = 0
    let rollbacks = 0
    let startedVersion = ''
    const candidate = { ...fixture.dsh, entry: path.join(directory, 'repaired', 'cli.js') }
    const engine = new RepairEngine({
      supervisor: { start: async (dsh) => { startedVersion = dsh.version; return 'http://127.0.0.1:43123' } },
      preflight: passingPreflight(), baselines: fixture.baselines,
      quarantine: fixture.quarantine, transactions: fixture.transactions,
      backups: { hasSource: async () => true, create: async () => undefined },
      managedVersions: {
        beginRepair: async (version) => {
          expect(version).toBe('0.1.0-rc.8')
          return {
            candidate,
            commit: async () => { commits += 1 },
            rollback: async () => { rollbacks += 1 }
          }
        }
      }
    })

    const result = await engine.repairManagedVersion(
      '0.1.0-rc.8', new Error('官方 DSH CLI 入口无效'), 'auto', 'https://registry.npmjs.org'
    )

    expect(result.session).toMatchObject({
      phase: 'recovered', outcome: 'recovered', repairAttempts: 1, retryAttempts: 1,
      diagnosis: { category: 'managed-install-corrupt' }
    })
    expect(result.session.actions).toEqual([expect.objectContaining({ kind: 'reinstall-managed-version', status: 'applied', target: '0.1.0-rc.8' })])
    expect(startedVersion).toBe('0.1.0-rc.8')
    expect(commits).toBe(1)
    expect(rollbacks).toBe(0)
  })

  it('重装候选版本启动失败时恢复旧程序目录', async () => {
    const fixture = await createFixture()
    let rollbacks = 0
    const engine = new RepairEngine({
      supervisor: { start: async () => { throw new Error('repaired version still cannot start') } },
      preflight: passingPreflight(), baselines: fixture.baselines,
      quarantine: fixture.quarantine, transactions: fixture.transactions,
      backups: { hasSource: async () => true, create: async () => undefined },
      managedVersions: {
        beginRepair: async () => ({
          candidate: fixture.dsh,
          commit: async () => undefined,
          rollback: async () => { rollbacks += 1 }
        })
      }
    })

    await expect(engine.repairManagedVersion(
      '0.1.0-rc.8', new Error('官方 DSH CLI 入口无效'), 'auto', 'https://registry.npmjs.org'
    )).rejects.toMatchObject({ session: { phase: 'failed', repairAttempts: 1, retryAttempts: 1 } })
    expect(rollbacks).toBe(1)
  })
})
