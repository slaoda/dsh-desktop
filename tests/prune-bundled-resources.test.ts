import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pruneBundledResources } from '../scripts/prune-bundled-resources.js'

const temporaryDirectories: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-prune-'))
  temporaryDirectories.push(root)
  const prebuilds = path.join(root, 'node_modules', 'node-pty', 'prebuilds')
  for (const name of ['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64', 'future-platform']) {
    await mkdir(path.join(prebuilds, name), { recursive: true })
    await writeFile(path.join(prebuilds, name, 'pty.node'), name)
  }
  await writeFile(path.join(prebuilds, 'win32-x64', 'pty.pdb'), 'debug symbols')
  return root
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('bundled release resource pruning', () => {
  it('Windows x64 保留运行文件并删除 PDB 调试符号', async () => {
    const root = await fixture()
    const result = await pruneBundledResources(root)

    expect(result.removedPrebuilds).toEqual(['darwin-arm64', 'darwin-x64', 'win32-arm64'])
    expect(await readFile(path.join(root, 'node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'pty.node'), 'utf8')).toBe('win32-x64')
    expect(await readFile(path.join(root, 'node_modules', 'node-pty', 'prebuilds', 'future-platform', 'pty.node'), 'utf8')).toBe('future-platform')
    expect(result.removedFiles).toBeGreaterThan(3)
    await expect(readFile(path.join(root, 'node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'pty.pdb'))).rejects.toThrow()
  })

  it('目标原生文件缺失时阻止产生不可运行的安装包', async () => {
    const root = await fixture()
    await rm(path.join(root, 'node_modules', 'node-pty', 'prebuilds', 'win32-x64'), { recursive: true })
    await expect(pruneBundledResources(root)).rejects.toThrow('node-pty 缺少 Windows x64 预编译文件')
  })
})
