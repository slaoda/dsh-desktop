import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RepairBaselineStore, findUniquePluginChange } from '../src/main/repair/repair-baseline'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

async function fixture(): Promise<{ userData: string; harnessHome: string }> {
  directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-repair-baseline-'))
  const userData = path.join(directory, 'desktop')
  const harnessHome = path.join(directory, '.dsh')
  const profile = path.join(harnessHome, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: { '@example/dsh-github': '1.2.3' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@example/dsh-github'] } }
  }))
  await writeFile(path.join(profile, 'cordis.patch.yml'), '- id: github-tools\n  disabled: false\n')
  await writeFile(path.join(harnessHome, 'cordis.patch.yml'), '[]\n')
  await writeFile(path.join(harnessHome, '.credentials.yaml'), 'apiKey: sk-never-read\n')
  await writeFile(path.join(harnessHome, '.env'), 'DEEPSEEK_API_KEY=sk-never-read-env\n')
  await mkdir(path.join(harnessHome, 'sessions'), { recursive: true })
  await writeFile(path.join(harnessHome, 'sessions', 'private.jsonl'), 'secret session body')
  return { userData, harnessHome }
}

describe('RepairBaselineStore', () => {
  it('只保存白名单 Profile 元数据、插件清单和配置哈希', async () => {
    const { userData, harnessHome } = await fixture()
    const store = new RepairBaselineStore(userData, harnessHome)

    const baseline = await store.capture({
      version: '0.1.0-rc.8',
      source: 'installed',
      effectiveConfig: '- id: github-tools\n  name: @example/dsh-github\n',
      entries: [{ entryId: 'github-tools', packageName: '@example/dsh-github' }]
    })

    expect(baseline).toMatchObject({
      schemaVersion: 1,
      version: '0.1.0-rc.8',
      source: 'installed',
      profile: {
        dependencies: { '@example/dsh-github': '1.2.3' },
        bundles: ['@deepseek-ai/dsh-base', '@example/dsh-github'],
        entries: [{ entryId: 'github-tools', packageName: '@example/dsh-github' }]
      },
      files: {
        profilePackage: { kind: 'file' },
        profilePatch: { kind: 'file' },
        homePatch: { kind: 'file' }
      }
    })
    expect(baseline.effectiveConfigSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(await store.read()).toEqual(baseline)

    const stored = await readFile(store.file, 'utf8')
    expect(stored).not.toContain('sk-never-read')
    expect(stored).not.toContain('.credentials')
    expect(stored).not.toContain('private.jsonl')
    expect(stored).not.toContain('secret session body')
  })

  it('忽略损坏、伪造路径或未知 schema 的旧基线', async () => {
    const { userData, harnessHome } = await fixture()
    const store = new RepairBaselineStore(userData, harnessHome)
    await mkdir(path.dirname(store.file), { recursive: true })
    await writeFile(store.file, JSON.stringify({ schemaVersion: 99, version: '../../escape', files: { credentials: 'stolen' } }))
    expect(await store.read()).toBeNull()
  })

  it('外部安装不能写入最后可用托管基线', async () => {
    const { userData, harnessHome } = await fixture()
    const store = new RepairBaselineStore(userData, harnessHome)
    await expect(store.capture({
      version: '0.1.0-rc.8', source: 'external', effectiveConfig: '[]', entries: []
    })).rejects.toThrow('外部')
  })

  it('配置文件不是普通文件或超过上限时不会读取正文', async () => {
    const { userData, harnessHome } = await fixture()
    await writeFile(path.join(harnessHome, 'cordis.patch.yml'), 'x'.repeat(2_097_153))
    const store = new RepairBaselineStore(userData, harnessHome)
    const baseline = await store.capture({ version: '0.1.0-rc.8', source: 'installed', effectiveConfig: '[]', entries: [] })
    expect(baseline.files.homePatch).toEqual({ kind: 'oversized' })
  })
})

describe('findUniquePluginChange', () => {
  it('只在新增或更新目标唯一时返回可疑插件', async () => {
    const { userData, harnessHome } = await fixture()
    const store = new RepairBaselineStore(userData, harnessHome)
    const previous = await store.capture({
      version: '0.1.0-rc.8', source: 'installed', effectiveConfig: 'a',
      entries: [{ entryId: 'github-tools', packageName: '@example/dsh-github' }]
    })

    const profilePackage = path.join(harnessHome, 'profiles', 'web', 'package.json')
    await writeFile(profilePackage, JSON.stringify({
      dependencies: { '@example/dsh-github': '1.2.3', '@example/dsh-calendar': '2.0.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@example/dsh-github', '@example/dsh-calendar'] } }
    }))
    const current = await store.capture({
      version: '0.1.0-rc.8', source: 'installed', effectiveConfig: 'b',
      entries: [
        { entryId: 'github-tools', packageName: '@example/dsh-github' },
        { entryId: 'calendar-tools', packageName: '@example/dsh-calendar' }
      ]
    })

    expect(findUniquePluginChange(previous, current)).toEqual({ entryId: 'calendar-tools', packageName: '@example/dsh-calendar' })
    expect(findUniquePluginChange(previous, { ...current, profile: { ...current.profile, entries: [
      ...current.profile.entries, { entryId: 'weather-tools', packageName: '@example/dsh-weather' }
    ] } })).toBeNull()
  })
})
