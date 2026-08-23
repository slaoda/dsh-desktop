import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BackupManager } from '../src/main/backup-manager'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

async function fixture(): Promise<{ home: string; userData: string }> {
  directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-backup-'))
  const home = path.join(directory, 'harness-home')
  const userData = path.join(directory, 'desktop-data')
  await Promise.all([
    mkdir(path.join(home, 'sessions', '--project--', 'session-1'), { recursive: true }),
    mkdir(path.join(home, 'skills', 'review'), { recursive: true }),
    mkdir(path.join(home, 'profiles', 'web'), { recursive: true })
  ])
  await Promise.all([
    writeFile(path.join(home, 'settings.yaml'), 'theme: dark\n'),
    writeFile(path.join(home, 'cordis.patch.yml'), 'plugins: []\n'),
    writeFile(path.join(home, '.credentials.yaml'), 'DEEPSEEK_API_KEY: sk-secret\n'),
    writeFile(path.join(home, '.env'), 'OPENAI_API_KEY=sk-secret\n'),
    writeFile(path.join(home, 'profiles', 'web', '.env'), 'TOKEN=secret\n'),
    writeFile(path.join(home, 'skills', 'review', 'SKILL.md'), '# Review\n'),
    writeFile(path.join(home, 'sessions', '--project--', 'session-1', 'session.jsonl'), '{"type":"session"}\n')
  ])
  return { home, userData }
}

describe('BackupManager', () => {
  it('按白名单备份配置和会话且在任意层级排除凭据', async () => {
    const { home, userData } = await fixture()
    const manager = new BackupManager(userData, home)

    const backup = await manager.create('manual', 'full')

    expect(backup.scope).toBe('full')
    expect(backup.fileCount).toBe(4)
    const data = path.join(manager.backupsDir, backup.id, 'data')
    await expect(readFile(path.join(data, 'settings.yaml'), 'utf8')).resolves.toBe('theme: dark\n')
    await expect(readFile(path.join(data, 'sessions', '--project--', 'session-1', 'session.jsonl'), 'utf8')).resolves.toContain('session')
    await expect(readFile(path.join(data, '.credentials.yaml'), 'utf8')).rejects.toThrow()
    await expect(readFile(path.join(data, '.env'), 'utf8')).rejects.toThrow()
    await expect(readFile(path.join(data, 'profiles', 'web', '.env'), 'utf8')).rejects.toThrow()
  })

  it('默认只保留最近三个完整备份', async () => {
    const { home, userData } = await fixture()
    const manager = new BackupManager(userData, home)
    for (let index = 0; index < 4; index += 1) await manager.create('manual', 'configuration')
    const backups = await manager.list()
    expect(backups).toHaveLength(3)
    expect(backups.map((item) => item.createdAt)).toEqual([...backups.map((item) => item.createdAt)].sort().reverse())
  })

  it('仅配置恢复不会覆盖会话并拒绝被篡改的备份', async () => {
    const { home, userData } = await fixture()
    const manager = new BackupManager(userData, home)
    const backup = await manager.create('manual', 'full')
    await writeFile(path.join(home, 'settings.yaml'), 'theme: light\n')
    const session = path.join(home, 'sessions', '--project--', 'session-1', 'session.jsonl')
    await writeFile(session, 'new session\n')

    await manager.restore(backup.id, 'configuration')

    await expect(readFile(path.join(home, 'settings.yaml'), 'utf8')).resolves.toBe('theme: dark\n')
    await expect(readFile(session, 'utf8')).resolves.toBe('new session\n')
    const storedSettings = path.join(manager.backupsDir, backup.id, 'data', 'settings.yaml')
    await writeFile(storedSettings, 'tampered\n')
    await expect(manager.restore(backup.id, 'configuration')).rejects.toThrow('完整性校验失败')
  })
})

