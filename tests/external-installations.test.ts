import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExternalInstallationManager, type ExternalCandidate } from '../src/main/external-installations'
import type { ProcessResult } from '../src/main/process-utils'
import { AppController } from '../src/main/controller'
import type { DshSupervisor } from '../src/main/dsh-supervisor'
import { DshRegistry } from '../src/main/registry'
import { StateStore } from '../src/main/state-store'
import type { VersionManager } from '../src/main/version-manager'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

async function officialPackage(prefix: string, version: string, bin = 'lib/bin.js'): Promise<string> {
  const root = path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh')
  await mkdir(path.join(root, 'lib'), { recursive: true })
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version, bin: { dsh: bin } }))
  await writeFile(path.join(root, 'lib', 'bin.js'), 'console.log("dsh")')
  return root
}

describe('ExternalInstallationManager', () => {
  it('验证官方包并区分全局可管理与项目只读安装', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-external-'))
    const globalRoot = await officialPackage(path.join(directory, 'global'), '1.2.3')
    const projectRoot = await officialPackage(path.join(directory, 'project'), '1.2.4-rc.1')
    const candidates: ExternalCandidate[] = [
      { packageRoot: globalRoot, source: 'npm-global', npmPrefix: path.join(directory, 'global') },
      { packageRoot: projectRoot, source: 'project' }
    ]
    const manager = new ExternalInstallationManager(
      { node: process.execPath, npmCli: 'npm-cli.js', pnpmCli: '', commandDir: '' },
      async () => candidates
    )

    const found = await manager.refresh()

    expect(found).toHaveLength(2)
    expect(found.find((item) => item.version === '1.2.3')).toMatchObject({ source: 'npm-global', readOnly: false, canUninstall: true })
    expect(found.find((item) => item.version === '1.2.4-rc.1')).toMatchObject({ source: 'project', readOnly: true, canUninstall: false })
  })

  it('拒绝伪造包身份和逃逸包根目录的 CLI', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-external-'))
    const fake = path.join(directory, 'fake')
    await mkdir(fake, { recursive: true })
    await writeFile(path.join(fake, 'package.json'), JSON.stringify({ name: 'evil-dsh', version: '1.0.0', bin: { dsh: 'cli.js' } }))
    await writeFile(path.join(fake, 'cli.js'), '')
    const escaped = await officialPackage(path.join(directory, 'escaped-prefix'), '1.0.0', '../../../outside.js')
    await writeFile(path.join(directory, 'escaped-prefix', 'outside.js'), '')
    const manager = new ExternalInstallationManager(
      { node: process.execPath, npmCli: 'npm-cli.js', pnpmCli: '', commandDir: '' },
      async () => [{ packageRoot: fake, source: 'environment' }, { packageRoot: escaped, source: 'environment' }]
    )
    await expect(manager.refresh()).resolves.toEqual([])
  })

  it('只通过明确的 npm 全局卸载命令处理可卸载条目', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-external-'))
    const prefix = path.join(directory, 'global')
    const globalRoot = await officialPackage(prefix, '1.2.3')
    const projectRoot = await officialPackage(path.join(directory, 'project'), '1.2.4')
    const run = vi.fn(async (): Promise<ProcessResult> => ({ stdout: '', stderr: '', code: 0 }))
    const manager = new ExternalInstallationManager(
      { node: process.execPath, npmCli: 'C:\\runtime\\npm-cli.js', pnpmCli: '', commandDir: '' },
      async () => [
        { packageRoot: globalRoot, source: 'npm-global', npmPrefix: prefix },
        { packageRoot: projectRoot, source: 'project' }
      ],
      run
    )
    const found = await manager.refresh()
    const global = found.find((item) => item.source === 'npm-global')!
    const project = found.find((item) => item.source === 'project')!

    await manager.uninstall(global.id)
    expect(run).toHaveBeenCalledWith(process.execPath, [
      'C:\\runtime\\npm-cli.js', 'uninstall', '--global', '@deepseek-ai/dsh', '--prefix', prefix
    ], { timeoutMs: 120_000 })
    await expect(manager.uninstall(project.id)).rejects.toThrow('只读')
  })

  it('控制器只允许选择可管理条目并持久化原地目标', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-external-'))
    const globalRoot = await officialPackage(path.join(directory, 'global'), '1.2.3')
    const projectRoot = await officialPackage(path.join(directory, 'project'), '1.2.4')
    const external = new ExternalInstallationManager(
      { node: process.execPath, npmCli: 'npm-cli.js', pnpmCli: '', commandDir: '' },
      async () => [
        { packageRoot: globalRoot, source: 'npm-global', npmPrefix: path.join(directory, 'global') },
        { packageRoot: projectRoot, source: 'project' }
      ]
    )
    class Supervisor extends EventEmitter {
      status: 'idle' | 'running' = 'idle'
      url: string | null = null
      async start(): Promise<string> { this.status = 'running'; this.url = 'http://127.0.0.1:41234'; this.emit('status', this.status); return this.url }
      async stop(): Promise<void> { this.status = 'idle'; this.url = null; this.emit('status', this.status) }
    }
    const versions = {
      cleanupInterruptedInstalls: async () => undefined,
      list: async () => [],
      resolve: async () => { throw new Error('no managed versions') }
    } as unknown as VersionManager
    const registry = new DshRegistry((async () => new Response(JSON.stringify({ versions: { '1.2.3': {} } }), { status: 200 })) as typeof fetch)
    const controller = new AppController(
      '0.3.0', new StateStore(directory), registry, versions, new Supervisor() as unknown as DshSupervisor,
      { node: process.execPath, npmCli: '', pnpmCli: '', commandDir: '' }, 'zh-CN', undefined, null, external
    )
    const initial = await controller.initialize()
    const project = initial.externalInstallations.find((item) => item.source === 'project')!
    const global = initial.externalInstallations.find((item) => item.source === 'npm-global')!

    await expect(controller.selectExternalInstallation(project.id)).rejects.toThrow('项目内依赖')
    const selected = await controller.selectExternalInstallation(global.id)
    expect(selected).toMatchObject({ selectedVersion: '1.2.3', selectedExternalId: global.id, runtimeStatus: 'running' })
    await expect(controller.uninstallExternalInstallation(global.id)).rejects.toThrow('当前使用')
  })
})
import { EventEmitter } from 'node:events'
