import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PluginQuarantineStore } from '../src/main/repair/plugin-quarantine'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('PluginQuarantineStore', () => {
  it('把隔离写成管理器拥有的 JSON Overlay 且不改用户 Patch', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-quarantine-'))
    const userData = path.join(directory, 'desktop')
    const userPatch = path.join(directory, '.dsh', 'cordis.patch.yml')
    await mkdir(path.dirname(userPatch), { recursive: true })
    await writeFile(userPatch, '- id: user-setting\n  disabled: false\n')
    const store = new PluginQuarantineStore(userData)

    const record = await store.activate({ entryId: 'github-tools', packageName: '@example/dsh-github' })

    expect(record).toMatchObject({ entryId: 'github-tools', packageName: '@example/dsh-github', disposition: 'pending' })
    expect(JSON.parse(await readFile(store.overlayFile, 'utf8'))).toEqual([{ id: 'github-tools', disabled: true }])
    expect(await readFile(userPatch, 'utf8')).toBe('- id: user-setting\n  disabled: false\n')
    expect(await store.overlayPath()).toBe(store.overlayFile)
  })

  it('拒绝不安全 entry id 和包名且不会创建 Overlay', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-quarantine-'))
    const store = new PluginQuarantineStore(directory)

    await expect(store.activate({ entryId: '../../escape', packageName: '@example/good' })).rejects.toThrow()
    await expect(store.activate({ entryId: 'good-id', packageName: 'bad package; rm' })).rejects.toThrow()
    await expect(access(store.overlayFile)).rejects.toThrow()
  })

  it('保持禁用会持久化，重新启用最后一个插件会移除 Overlay', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-quarantine-'))
    const store = new PluginQuarantineStore(directory)
    await store.activate({ entryId: 'github-tools', packageName: '@example/dsh-github' })

    expect(await store.keep('github-tools')).toMatchObject({ disposition: 'kept' })
    expect((await store.list())[0]).toMatchObject({ disposition: 'kept' })
    await store.remove('github-tools')

    expect(await store.list()).toEqual([])
    expect(await store.overlayPath()).toBeNull()
    await expect(access(store.overlayFile)).rejects.toThrow()
  })

  it('损坏状态不会把任意内容转换为启动参数', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-quarantine-'))
    const store = new PluginQuarantineStore(directory)
    await mkdir(path.dirname(store.stateFile), { recursive: true })
    await writeFile(store.stateFile, JSON.stringify({ schemaVersion: 1, records: [{ entryId: '../../escape', disposition: 'kept' }] }))
    await writeFile(store.overlayFile, '[{"id":"stale","disabled":true}]')

    expect(await store.list()).toEqual([])
    expect(await store.overlayPath()).toBeNull()
  })
})
