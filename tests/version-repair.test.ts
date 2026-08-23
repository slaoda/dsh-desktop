import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { VersionManager } from '../src/main/version-manager'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let directory = ''
afterEach(async () => {
  delete process.env.FAKE_PNPM_FAIL
  if (directory) await rm(directory, { recursive: true, force: true })
})

async function installedManager(): Promise<{ manager: VersionManager; entry: string }> {
  directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-version-repair-'))
  const manager = new VersionManager(directory, path.join(directory, 'bundled'), {
    node: process.execPath,
    npmCli: path.join(root, 'tests/fixtures/fake-npm.mjs'),
    pnpmCli: path.join(root, 'tests/fixtures/fake-pnpm.mjs'),
    commandDir: path.join(root, 'node_modules/.bin')
  })
  await manager.install('1.2.3', ['1.2.3'], () => undefined)
  const resolved = await manager.resolve('1.2.3')
  await writeFile(resolved.entry, 'broken original installation')
  return { manager, entry: resolved.entry }
}

describe('VersionManager exact-version repair', () => {
  it('同一精确版本验证成功后可以提交并清理旧目录', async () => {
    const { manager, entry } = await installedManager()
    const transaction = await manager.beginRepair('1.2.3', () => undefined)

    expect(transaction.candidate.version).toBe('1.2.3')
    expect(transaction.candidate.source).toBe('installed')
    expect(await readFile(transaction.candidate.entry, 'utf8')).toContain('console.log("fake")')
    await transaction.commit()

    expect(await readFile(entry, 'utf8')).toContain('console.log("fake")')
    expect(await manager.readRepairTransaction()).toBeNull()
  })

  it('候选版本启动失败时恢复修复前的原目录', async () => {
    const { manager, entry } = await installedManager()
    const transaction = await manager.beginRepair('1.2.3', () => undefined)
    await transaction.rollback()

    expect(await readFile(entry, 'utf8')).toBe('broken original installation')
    expect(await manager.readRepairTransaction()).toBeNull()
  })

  it('应用在原子交换后中断时下次清理会恢复旧目录', async () => {
    const { manager, entry } = await installedManager()
    await manager.beginRepair('1.2.3', () => undefined)
    expect(await readFile(entry, 'utf8')).toContain('console.log("fake")')

    await manager.cleanupInterruptedInstalls()

    expect(await readFile(entry, 'utf8')).toBe('broken original installation')
    expect(await manager.readRepairTransaction()).toBeNull()
  })

  it('拒绝非精确版本和带凭据的镜像地址且不改变原安装', async () => {
    const { manager, entry } = await installedManager()
    await expect(manager.beginRepair('../escape', () => undefined)).rejects.toThrow()
    await expect(manager.beginRepair('1.2.3', () => undefined, 'https://user:secret@example.test')).rejects.toThrow()
    expect(await readFile(entry, 'utf8')).toBe('broken original installation')
  })

  it('入口缺失的已安装版本仍保留在管理清单中以便修复', async () => {
    const { manager, entry } = await installedManager()
    await rm(entry)
    expect(await manager.list()).toContainEqual({ version: '1.2.3', source: 'installed' })
    await expect(manager.resolve('1.2.3')).rejects.toThrow('CLI 入口无效')
  })

  it('损坏的官方包清单返回稳定的托管安装校验错误', async () => {
    const { manager, entry } = await installedManager()
    const manifest = path.join(path.dirname(entry), 'package.json')
    await writeFile(manifest, '{ invalid json')

    await expect(manager.resolve('1.2.3')).rejects.toThrow('包身份或版本校验失败')
    expect(await manager.list()).toContainEqual({ version: '1.2.3', source: 'installed' })
  })

  it('下载或安装候选失败时不交换原目录', async () => {
    const { manager, entry } = await installedManager()
    process.env.FAKE_PNPM_FAIL = '1'
    await expect(manager.beginRepair('1.2.3', () => undefined)).rejects.toThrow('node: command not found')
    expect(await readFile(entry, 'utf8')).toBe('broken original installation')
    expect(await manager.readRepairTransaction()).toBeNull()
  })
})
