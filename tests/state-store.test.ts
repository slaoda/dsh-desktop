import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StateStore } from '../src/main/state-store'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('StateStore', () => {
  it('首次读取返回默认值并以原子文件保存', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-state-'))
    const store = new StateStore(directory)
    expect(await store.read()).toEqual({
      schemaVersion: 6, selectedVersion: null, selectedExternalId: null, dismissedLatest: null, localePreference: 'system',
      releaseChannel: 'all', registryUrl: 'https://registry.npmjs.org', closeToTray: true, startAtLogin: false,
      proxyMode: 'system', manualProxyUrl: null, repairMode: 'auto'
    })
    await store.write({
      schemaVersion: 6, selectedVersion: '0.1.0-rc.6', selectedExternalId: null, dismissedLatest: null, localePreference: 'en-US',
      releaseChannel: 'all', registryUrl: 'https://registry.example.test/npm', closeToTray: false, startAtLogin: true,
      proxyMode: 'manual', manualProxyUrl: 'http://127.0.0.1:7890', repairMode: 'ask'
    })
    expect(JSON.parse(await readFile(store.file, 'utf8'))).toMatchObject({ selectedVersion: '0.1.0-rc.6', localePreference: 'en-US', repairMode: 'ask' })
  })

  it('兼容没有语言字段的旧状态文件', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-state-'))
    const store = new StateStore(directory)
    await writeFile(store.file, JSON.stringify({ schemaVersion: 1, selectedVersion: null, dismissedLatest: null }))
    const legacy = JSON.parse(await readFile(store.file, 'utf8'))
    delete legacy.localePreference
    await writeFile(store.file, JSON.stringify(legacy))
    expect((await store.read()).localePreference).toBe('system')
    expect(await store.read()).toMatchObject({ schemaVersion: 6, selectedExternalId: null, releaseChannel: 'all', registryUrl: 'https://registry.npmjs.org', closeToTray: true, startAtLogin: false, proxyMode: 'system', manualProxyUrl: null, repairMode: 'auto' })
  })

  it('丢弃状态文件中的无效渠道和危险镜像地址', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-state-'))
    const store = new StateStore(directory)
    await writeFile(store.file, JSON.stringify({ releaseChannel: 'nightly', registryUrl: 'https://user:secret@example.test' }))
    expect(await store.read()).toMatchObject({ releaseChannel: 'all', registryUrl: 'https://registry.npmjs.org' })
  })

  it('旧状态默认关闭到托盘且不开机启动', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-state-'))
    const store = new StateStore(directory)
    await writeFile(store.file, JSON.stringify({ schemaVersion: 3, closeToTray: 'yes', startAtLogin: 1 }))
    expect(await store.read()).toMatchObject({ closeToTray: true, startAtLogin: false })
  })

  it('迁移旧状态并丢弃无效修复模式', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-state-'))
    const store = new StateStore(directory)
    await writeFile(store.file, JSON.stringify({ schemaVersion: 5, repairMode: 'run-any-command' }))

    expect(await store.read()).toMatchObject({ schemaVersion: 6, repairMode: 'auto' })
  })
})
