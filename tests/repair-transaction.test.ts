import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PluginQuarantineStore } from '../src/main/repair/plugin-quarantine'
import { RepairTransactionStore } from '../src/main/repair/repair-transaction'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('RepairTransactionStore', () => {
  it('中断恢复会撤销本轮新建的插件隔离', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-repair-transaction-'))
    const quarantine = new PluginQuarantineStore(directory)
    const transactions = new RepairTransactionStore(directory)
    await transactions.beginPluginQuarantine({
      repairId: '11111111-1111-4111-8111-111111111111',
      entryId: 'github-tools',
      packageName: '@example/dsh-github',
      previous: null
    })
    await quarantine.activate({ entryId: 'github-tools', packageName: '@example/dsh-github' })
    await transactions.mark('retrying')

    expect(await transactions.recover(quarantine)).toBe(true)
    expect(await quarantine.list()).toEqual([])
    expect(await transactions.read()).toBeNull()
    await expect(access(transactions.file)).rejects.toThrow()
  })

  it('恢复时还原隔离前已经保持禁用的记录', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-repair-transaction-'))
    const quarantine = new PluginQuarantineStore(directory)
    const transactions = new RepairTransactionStore(directory)
    await quarantine.activate({ entryId: 'github-tools', packageName: '@example/dsh-github' })
    const previous = await quarantine.keep('github-tools')
    await transactions.beginPluginQuarantine({
      repairId: '22222222-2222-4222-8222-222222222222',
      entryId: 'github-tools',
      packageName: '@example/dsh-github-next',
      previous
    })
    await quarantine.activate({ entryId: 'github-tools', packageName: '@example/dsh-github-next' })

    expect(await transactions.recover(quarantine)).toBe(true)
    expect(await quarantine.list()).toEqual([previous])
  })

  it('完整事务可以提交且不会撤销成功的隔离', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-repair-transaction-'))
    const quarantine = new PluginQuarantineStore(directory)
    const transactions = new RepairTransactionStore(directory)
    await transactions.beginPluginQuarantine({
      repairId: '33333333-3333-4333-8333-333333333333',
      entryId: 'github-tools',
      packageName: '@example/dsh-github',
      previous: null
    })
    await quarantine.activate({ entryId: 'github-tools', packageName: '@example/dsh-github' })
    await transactions.mark('applied')
    await transactions.complete()

    expect(await transactions.recover(quarantine)).toBe(false)
    expect(await quarantine.list()).toHaveLength(1)
  })
})
