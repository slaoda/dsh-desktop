import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { AppController } from '../src/main/controller'
import { DshSupervisor } from '../src/main/dsh-supervisor'
import { DshRegistry } from '../src/main/registry'
import { StateStore } from '../src/main/state-store'
import { VersionManager } from '../src/main/version-manager'
import type { RepairSessionSummary } from '../src/shared/contracts'
import type { StartupRepairEngine } from '../src/main/repair/repair-engine'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('AppController', () => {
  it('提示并安装新版本但保持当前选择，用户确认后才切换', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-controller-'))
    const runtime = {
      node: process.execPath,
      npmCli: path.join(root, 'tests/fixtures/fake-npm.mjs'),
      pnpmCli: path.join(root, 'tests/fixtures/fake-pnpm.mjs'),
      commandDir: path.dirname(process.execPath)
    }
    const versions = new VersionManager(directory, path.join(directory, 'bundled'), runtime)
    await versions.install('1.0.0', ['1.0.0'], () => undefined)
    const fetcher = async () => new Response(JSON.stringify({
      versions: { '1.0.0': {}, '1.1.0': {} }, 'dist-tags': { latest: '1.1.0' }
    }), { status: 200 })
    const controller = new AppController('0.1.0', new StateStore(directory), new DshRegistry(fetcher as typeof fetch), versions, new DshSupervisor(process.execPath), runtime)
    expect((await controller.initialize()).selectedVersion).toBe('1.0.0')
    const refreshed = await controller.refresh()
    expect(refreshed.latestVersion).toBe('1.1.0')
    expect(refreshed.selectedVersion).toBe('1.0.0')
    expect(refreshed.availableVersions.map((item) => item.version)).toEqual(['1.1.0', '1.0.0'])
    expect((await controller.dismissUpdate('1.1.0')).dismissedLatest).toBe('1.1.0')
    expect((await controller.install('1.1.0')).selectedVersion).toBe('1.0.0')
    expect((await controller.select('1.1.0')).selectedVersion).toBe('1.1.0')
    await expect(controller.uninstall('1.1.0')).rejects.toThrow('无法卸载当前使用')
    expect((await controller.uninstall('1.0.0')).installedVersions.map((item) => item.version)).toEqual(['1.1.0'])
    expect((await controller.setLocale('en-US'))).toMatchObject({ locale: 'en-US', localePreference: 'en-US' })
    expect((await controller.setDesktopPreferences(false, true))).toMatchObject({ closeToTray: false, startAtLogin: true })
    const stable = await controller.setVersionPreferences('stable', 'https://registry.example.test/npm')
    expect(stable).toMatchObject({ releaseChannel: 'stable', registryUrl: 'https://registry.example.test/npm', latestVersion: '1.1.0' })
  })

  it('通过修复引擎启动并把修复会话放入应用快照', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-controller-repair-'))
    const runtime = {
      node: process.execPath,
      npmCli: path.join(root, 'tests/fixtures/fake-npm.mjs'),
      pnpmCli: path.join(root, 'tests/fixtures/fake-pnpm.mjs'),
      commandDir: path.dirname(process.execPath)
    }
    const versions = new VersionManager(directory, path.join(directory, 'bundled'), runtime)
    await versions.install('1.0.0', ['1.0.0'], () => undefined)
    const resolved = await versions.resolve('1.0.0')
    await writeFile(resolved.entry, await readFile(path.join(root, 'tests/fixtures/fake-dsh.mjs'), 'utf8'))
    const supervisor = new DshSupervisor(process.execPath)
    const session: RepairSessionSummary = {
      id: '11111111-1111-4111-8111-111111111111',
      phase: 'completed', outcome: 'not-needed', diagnosis: null, actions: [],
      repairAttempts: 0, retryAttempts: 0, quarantinedPlugin: null
    }
    class FakeRepairEngine extends EventEmitter implements StartupRepairEngine {
      recoverCalls = 0
      mode: string | null = null
      async recoverInterrupted(): Promise<boolean> { this.recoverCalls += 1; return false }
      async launch(dsh: typeof resolved, mode: 'auto' | 'ask' | 'diagnose') {
        this.mode = mode
        this.emit('session', session)
        return { url: await supervisor.start(dsh, { timeoutMs: 5_000, stabilityMs: 0 }), session }
      }
    }
    const engine = new FakeRepairEngine()
    const controller = new AppController(
      '0.1.0', new StateStore(directory), new DshRegistry(async () => new Response('{}') as never),
      versions, supervisor, runtime, 'zh-CN', undefined, null, null, null, engine
    )

    await controller.initialize()
    const launched = await controller.launch()

    expect(engine.recoverCalls).toBe(1)
    expect(engine.mode).toBe('auto')
    expect(launched).toMatchObject({ runtimeStatus: 'running', runtimeUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/), repairSession: session })
    await controller.stop()
  })
})
