import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { DshPreflight, dshDumpConfigArguments, parseDumpedPluginEntries } from '../src/main/repair/dsh-preflight'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('dshDumpConfigArguments', () => {
  const dsh = { version: '1.0.0', root, entry: path.join(root, 'tests/fixtures/fake-dsh-dump.mjs'), source: 'installed' as const }

  it('使用 web 配置转储且只附加经过验证的 Overlay', () => {
    const overlay = path.resolve('C:\\desktop\\repair\\plugin-quarantine.patch.json')
    expect(dshDumpConfigArguments(dsh, null)).toEqual([dsh.entry, 'web', '--dump-config'])
    expect(dshDumpConfigArguments(dsh, overlay)).toEqual([dsh.entry, 'web', '--patch', overlay, '--dump-config'])
    expect(() => dshDumpConfigArguments(dsh, 'relative.patch.json')).toThrow('绝对路径')
  })
})

describe('parseDumpedPluginEntries', () => {
  it('只提取有效 entry id 与 npm 包名并忽略本地路径', () => {
    expect(parseDumpedPluginEntries(`
- id: github-tools
  name: '@example/dsh-github'
- id: local-tool
  name: ./local.ts
- id: bad id
  name: '@example/ignored'
`)).toEqual([{ entryId: 'github-tools', packageName: '@example/dsh-github' }])
  })
})

describe('DshPreflight', () => {
  it('使用精确入口执行只读配置体检并返回插件清单', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-preflight-'))
    const repairRoot = path.join(directory, 'repair')
    await mkdir(repairRoot, { recursive: true })
    const overlay = path.join(repairRoot, 'plugin-quarantine.patch.json')
    await writeFile(overlay, '[{"id":"old-plugin","disabled":true}]\n')
    const preflight = new DshPreflight(process.execPath, [], repairRoot)

    const result = await preflight.inspect({
      version: '1.0.0', root, entry: path.join(root, 'tests/fixtures/fake-dsh-dump.mjs'), source: 'installed'
    }, overlay)

    expect(result.status).toBe('passed')
    expect(result.effectiveConfig).toContain('github-tools')
    expect(result.entries).toEqual([{ entryId: 'github-tools', packageName: '@example/dsh-github' }])
  })

  it('拒绝 repair 目录之外或符号链接的 Overlay', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-preflight-'))
    const repairRoot = path.join(directory, 'repair')
    await mkdir(repairRoot, { recursive: true })
    const outside = path.join(directory, 'outside.patch.json')
    await writeFile(outside, '[]')
    const preflight = new DshPreflight(process.execPath, [], repairRoot)
    const dsh = { version: '1.0.0', root, entry: path.join(root, 'tests/fixtures/fake-dsh-dump.mjs'), source: 'installed' as const }

    await expect(preflight.inspect(dsh, outside)).rejects.toThrow('管理器修复目录')
  })

  it('外部安装跳过会运行命令的体检', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-preflight-'))
    const preflight = new DshPreflight('does-not-exist.exe', [], path.join(directory, 'repair'))
    const result = await preflight.inspect({ version: '1.0.0', root, entry: 'missing.mjs', source: 'external' }, null)
    expect(result).toEqual({ status: 'skipped', effectiveConfig: null, entries: [] })
  })
})
