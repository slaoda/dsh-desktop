import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppController } from '../src/main/controller'
import type { DshSupervisor } from '../src/main/dsh-supervisor'
import { DshRegistry } from '../src/main/registry'
import { StateStore } from '../src/main/state-store'
import { SwitchTransactionStore } from '../src/main/switch-transaction'
import type { VersionManager } from '../src/main/version-manager'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

class FakeSupervisor extends EventEmitter {
  status: 'idle' | 'running' | 'failed' = 'idle'
  url: string | null = null

  async start(target: { version: string }): Promise<string> {
    if (target.version === '2.0.0') {
      this.status = 'failed'
      this.emit('status', this.status)
      throw new Error('candidate failed health check')
    }
    this.status = 'running'
    this.url = 'http://127.0.0.1:43123'
    this.emit('status', this.status)
    return this.url
  }

  async stop(): Promise<void> {
    this.status = 'idle'
    this.url = null
    this.emit('status', this.status)
  }
}

function fakeVersions(): VersionManager {
  return {
    cleanupInterruptedInstalls: async () => undefined,
    list: async () => [
      { version: '1.0.0', source: 'installed' as const },
      { version: '2.0.0', source: 'installed' as const }
    ],
    resolve: async (version: string) => ({ version, root: `C:\\managed\\${version}`, entry: `C:\\managed\\${version}\\cli.js`, source: 'installed' as const })
  } as unknown as VersionManager
}

function registry(): DshRegistry {
  return new DshRegistry((async () => new Response(JSON.stringify({ versions: { '1.0.0': {}, '2.0.0': {} } }), { status: 200 })) as typeof fetch)
}

describe('recoverable version switching', () => {
  it('候选版本健康检查失败时自动启动旧版本且不提交新选择', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-switch-'))
    const store = new StateStore(directory)
    const state = await store.read()
    state.selectedVersion = '1.0.0'
    await store.write(state)
    const transactions = new SwitchTransactionStore(directory)
    const controller = new AppController(
      '0.3.0', store, registry(), fakeVersions(), new FakeSupervisor() as unknown as DshSupervisor,
      { node: process.execPath, npmCli: '', pnpmCli: '', commandDir: '' }, 'zh-CN', transactions
    )
    await controller.initialize()

    const result = await controller.switchAndLaunch('2.0.0')

    expect(result).toMatchObject({ selectedVersion: '1.0.0', runtimeStatus: 'running', runtimeUrl: 'http://127.0.0.1:43123' })
    expect(result.error).toContain('已自动回退到 1.0.0')
    await expect(transactions.read()).resolves.toBeNull()
    expect((await store.read()).selectedVersion).toBe('1.0.0')
  })

  it('启动中断留下事务时在初始化阶段恢复旧选择', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-switch-'))
    const store = new StateStore(directory)
    const state = await store.read()
    state.selectedVersion = '2.0.0'
    await store.write(state)
    const transactions = new SwitchTransactionStore(directory)
    await transactions.begin('1.0.0', '2.0.0')
    const controller = new AppController(
      '0.3.0', store, registry(), fakeVersions(), new FakeSupervisor() as unknown as DshSupervisor,
      { node: process.execPath, npmCli: '', pnpmCli: '', commandDir: '' }, 'zh-CN', transactions
    )

    const result = await controller.initialize()

    expect(result.selectedVersion).toBe('1.0.0')
    expect(result.error).toContain('已恢复到 1.0.0')
    await expect(transactions.read()).resolves.toBeNull()
  })
})

