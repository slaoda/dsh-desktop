import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

export type DiagnosticLevel = 'info' | 'warn' | 'error'

export function redactDiagnostic(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/("(?:[^"\\]|\\.)*(?:api[_-]?key|token|password|secret|authorization)(?:[^"\\]|\\.)*"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"[REDACTED]"')
    .replace(/\b([A-Z0-9_-]*(?:API[_-]?KEY|TOKEN|PASSWORD|SECRET|AUTHORIZATION)[A-Z0-9_-]*)["']?\s*[:=]\s*(?:Bearer\s+)?([^\s,;"']+)/gi, '$1=[REDACTED]')
    .replace(/\bpassword\s*[:=]\s*([^\s,;"']+)/gi, 'password=[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED]')
}

export class DiagnosticLogger {
  readonly directory: string
  readonly file: string
  private pending: Promise<void> = Promise.resolve()

  constructor(userData: string, private readonly maxBytes = 1_048_576) {
    this.directory = path.join(userData, 'diagnostics')
    this.file = path.join(this.directory, 'manager.log')
  }

  log(level: DiagnosticLevel, event: string, data: Record<string, unknown> = {}): Promise<void> {
    const safeEvent = event.replace(/[^a-z0-9._-]/gi, '-').slice(0, 80)
    this.pending = this.pending.then(async () => {
      await mkdir(this.directory, { recursive: true })
      await this.rotateIfNeeded()
      const record = redactDiagnostic(JSON.stringify({ time: new Date().toISOString(), level, event: safeEvent, data })).slice(0, 65_536)
      await appendFile(this.file, `${record}\n`, { encoding: 'utf8', mode: 0o600 })
    }).catch(() => undefined)
    return this.pending
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const current = await stat(this.file)
      if (current.size < this.maxBytes) return
      const rotated = `${this.file}.1`
      await rm(rotated, { force: true })
      await rename(this.file, rotated)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
