import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ResolvedDsh } from '../src/main/version-manager'
import { PluginQuarantineStore } from '../src/main/repair/plugin-quarantine'
import { PluginRepairActions } from '../src/main/repair/plugin-repair-actions'
import { RepairTransactionStore } from '../src/main/repair/repair-transaction'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

async function fixture(dependencies: Record<string, string> = { '@example/dsh-github': '1.2.3' }) {
  directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-actions-'))
  const userData = path.join(directory, 'desktop')
  const harnessHome = path.join(directory, '.dsh')
  const profile = path.join(harnessHome, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ dependencies }))
  const quarantine = new PluginQuarantineStore(userData)
  await quarantine.activate({ entryId: 'github-tools', packageName: '@example/dsh-github' })
  const dsh: ResolvedDsh = {
    version: '0.1.0-rc.8', root: path.join(directory, 'managed'),
    entry: path.join(directory, 'managed', 'cli.js'), source: 'installed'
  }
  return { userData, harnessHome, quarantine, dsh }
}

function passingPreflight() {
  return { inspect: async () => ({ status: 'passed' as const, effectiveConfig: '[]', entries: [] }) }
}

describe('PluginRepairActions', () => {
  it('保持禁用只更新管理器隔离记录', async () => {
    const value = await fixture()
    const actions = new PluginRepairActions({
      quarantine: value.quarantine,
      transactions: new RepairTransactionStore(value.userData),
      preflight: passingPreflight(),
      supervisor: { stop: async () => undefined, start: async () => 'http://127.0.0.1:43123' },
      backups: null,
      harnessHome: value.harnessHome,
      uninstallPackage: async () => undefined
    })
    expect(await actions.keep('github-tools')).toMatchObject({ disposition: 'kept' })
  })

  it('重新启用成功会移除隔离并提交事务', async () => {
    const value = await fixture()
    const overlays: Array<string | null> = []
    const transactions = new RepairTransactionStore(value.userData)
    const actions = new PluginRepairActions({
      quarantine: value.quarantine, transactions, preflight: passingPreflight(),
      supervisor: {
        stop: async () => undefined,
        start: async (_dsh, options) => { overlays.push(options?.repairOverlay ?? null); return 'http://127.0.0.1:43123' }
      },
      backups: null, harnessHome: value.harnessHome, uninstallPackage: async () => undefined
    })

    expect(await actions.reenable(value.dsh, 'github-tools')).toMatchObject({ url: 'http://127.0.0.1:43123' })
    expect(overlays).toEqual([null])
    expect(await value.quarantine.list()).toEqual([])
    expect(await transactions.read()).toBeNull()
  })

  it('重新启用失败会恢复隔离并用安全 Overlay 重启一次', async () => {
    const value = await fixture()
    await value.quarantine.keep('github-tools')
    const overlays: Array<string | null> = []
    let starts = 0
    const actions = new PluginRepairActions({
      quarantine: value.quarantine,
      transactions: new RepairTransactionStore(value.userData),
      preflight: passingPreflight(),
      supervisor: {
        stop: async () => undefined,
        start: async (_dsh, options) => {
          starts += 1
          overlays.push(options?.repairOverlay ?? null)
          if (starts === 1) throw new Error('plugin conflict returned')
          return 'http://127.0.0.1:43123'
        }
      },
      backups: null, harnessHome: value.harnessHome, uninstallPackage: async () => undefined
    })

    await expect(actions.reenable(value.dsh, 'github-tools')).rejects.toThrow('plugin conflict returned')
    expect(overlays).toEqual([null, value.quarantine.overlayFile])
    expect(await value.quarantine.list()).toEqual([expect.objectContaining({ entryId: 'github-tools', disposition: 'kept' })])
  })

  it('包不是 Web Profile 直接依赖时拒绝卸载', async () => {
    const value = await fixture({ '@example/another-plugin': '1.0.0' })
    let uninstallCalls = 0
    const actions = new PluginRepairActions({
      quarantine: value.quarantine,
      transactions: new RepairTransactionStore(value.userData),
      preflight: passingPreflight(),
      supervisor: { stop: async () => undefined, start: async () => 'http://127.0.0.1:43123' },
      backups: { hasSource: async () => true, create: async () => undefined },
      harnessHome: value.harnessHome,
      uninstallPackage: async () => { uninstallCalls += 1 }
    })

    await expect(actions.uninstall(value.dsh, 'github-tools')).rejects.toThrow('直接依赖')
    expect(uninstallCalls).toBe(0)
    expect(await value.quarantine.list()).toHaveLength(1)
  })

  it('确认来源后备份、调用官方卸载并以剩余 Overlay 启动', async () => {
    const value = await fixture()
    const events: string[] = []
    const actions = new PluginRepairActions({
      quarantine: value.quarantine,
      transactions: new RepairTransactionStore(value.userData),
      preflight: passingPreflight(),
      supervisor: {
        stop: async () => { events.push('stop') },
        start: async (_dsh, options) => { events.push(`start:${options?.repairOverlay ?? 'none'}`); return 'http://127.0.0.1:43123' }
      },
      backups: {
        hasSource: async () => true,
        create: async (reason, scope) => { events.push(`backup:${reason}:${scope}`) }
      },
      harnessHome: value.harnessHome,
      uninstallPackage: async (dsh, packageName) => { events.push(`remove:${dsh.version}:${packageName}`) }
    })

    const result = await actions.uninstall(value.dsh, 'github-tools')

    expect(result).toEqual({ url: 'http://127.0.0.1:43123', packageName: '@example/dsh-github' })
    expect(events).toEqual([
      'stop', 'backup:pre-repair:configuration', 'remove:0.1.0-rc.8:@example/dsh-github', 'start:none'
    ])
    expect(await value.quarantine.list()).toEqual([])
  })
})
