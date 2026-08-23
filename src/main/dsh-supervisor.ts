import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import semver from 'semver'
import type { RuntimeStatus } from '../shared/contracts'
import type { ResolvedDsh } from './version-manager'
import { prependRuntimePath } from './runtime-path-environment'

export { prependRuntimePath } from './runtime-path-environment'

const noOpenMinimumVersion = '0.1.0-rc.8'

export function dshWebArguments(dsh: ResolvedDsh, repairOverlay: string | null = null): string[] {
  if (repairOverlay !== null && !path.isAbsolute(repairOverlay)) throw new Error('插件隔离 Overlay 必须使用绝对路径')
  return [
    dsh.entry,
    'web',
    ...(repairOverlay ? ['--patch', repairOverlay] : []),
    ...(semver.gte(dsh.version, noOpenMinimumVersion) ? ['--no-open'] : []),
    '--port',
    '0'
  ]
}

export function parseLoopbackUrl(output: string): string | null {
  const matches = output.match(/https?:\/\/[^\s'"<>]+/g) ?? []
  for (const candidate of matches) {
    try {
      const url = new URL(candidate.replace(/[),.;]+$/, ''))
      if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && !url.username && !url.password) {
        return url.origin
      }
    } catch { /* Continue scanning output. */ }
  }
  return null
}

const failureDetailLimit = 600

/**
 * Extracts the most informative line of the child's captured output so launch
 * failures show the official CLI's own error (for example an incompatible
 * `~/.dsh` document) instead of only an exit code. Node uncaught exceptions
 * put the summary on the first `Error:` line; other output falls back to the
 * first non-empty line.
 */
export function summarizeDshFailure(output: string): string {
  const lines = output
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const headline = lines.find((line) => line.startsWith('Error:')) ?? lines[0] ?? ''
  return headline.slice(0, failureDetailLimit)
}

export function dshRuntimeEnvironment(environment: NodeJS.ProcessEnv, entries: string[]): NodeJS.ProcessEnv {
  return {
    ...prependRuntimePath(environment, entries),
    // pnpm 11 still blocks unapproved dependency build scripts, but this keeps
    // that safety decision from turning an otherwise valid plugin update into
    // ERR_PNPM_IGNORED_BUILDS. This setting is scoped to the official DSH child.
    pnpm_config_strict_dep_builds: 'false'
  }
}

export function dshChildEnvironment(
  environment: NodeJS.ProcessEnv,
  dsh: ResolvedDsh,
  nodePath: string,
  runtimePathEntries: string[]
): NodeJS.ProcessEnv {
  return {
    ...dshRuntimeEnvironment(environment, runtimePathEntries),
    DSH_DESKTOP_NODE: nodePath,
    DSH_DESKTOP_DSH_ENTRY: dsh.entry
  }
}

export interface DshStartOptions {
  timeoutMs?: number
  stabilityMs?: number
  healthTimeoutMs?: number
  repairOverlay?: string | null
}

export type DshHealthProbe = (url: string, timeoutMs: number) => Promise<boolean>

async function probeLoopback(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: controller.signal })
    await response.body?.cancel()
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function boundedDuration(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) throw new Error(`${label}无效`)
  return resolved
}

export class DshSupervisor extends EventEmitter {
  status: RuntimeStatus = 'idle'
  url: string | null = null
  private child: ChildProcessWithoutNullStreams | null = null

  constructor(
    private readonly nodePath: string,
    private readonly runtimePathEntries: string[] = [],
    private readonly healthProbe: DshHealthProbe = probeLoopback
  ) {
    super()
  }

  async start(dsh: ResolvedDsh, options: DshStartOptions = {}): Promise<string> {
    if (this.child || this.status === 'starting' || this.status === 'running') throw new Error('DSH 已经在运行')
    const timeoutMs = boundedDuration(options.timeoutMs, 30_000, 100, 120_000, '启动超时')
    const stabilityMs = boundedDuration(options.stabilityMs, 2_000, 0, 10_000, '启动稳定窗口')
    const healthTimeoutMs = boundedDuration(options.healthTimeoutMs, 3_000, 100, 10_000, '健康检查超时')
    this.setStatus('starting')

    return await new Promise<string>((resolve, reject) => {
      const child = spawn(this.nodePath, dshWebArguments(dsh, options.repairOverlay ?? null), {
        cwd: os.homedir(),
        // Official plugin management invokes `dsh` by name. The Desktop-owned
        // launcher delegates to this exact validated entry without using pnpm's
        // relocatable-installation shims, which retain obsolete staging paths.
        env: dshChildEnvironment(process.env, dsh, this.nodePath, this.runtimePathEntries),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      child.stdin.end()
      this.child = child
      let completed = false
      let candidateUrl: string | null = null
      let buffer = ''
      const finishWithError = (message: string): void => {
        if (completed) return
        completed = true
        clearTimeout(timer)
        if (!child.killed) child.kill()
        this.child = null
        this.url = null
        this.setStatus('failed')
        const detail = summarizeDshFailure(buffer)
        reject(new Error(detail ? `${message}：${detail}` : message))
      }
      const consume = (chunk: Buffer | string): void => {
        buffer = `${buffer}${chunk.toString()}`.slice(-8_192)
        const url = parseLoopbackUrl(buffer)
        if (!url || candidateUrl || completed) return
        candidateUrl = url
        void (async () => {
          if (stabilityMs > 0) await new Promise<void>((done) => setTimeout(done, stabilityMs))
          if (completed || this.child !== child) return
          if (!await this.healthProbe(url, healthTimeoutMs)) {
            finishWithError('官方 DSH 未通过本机 HTTP 健康检查')
            return
          }
          if (completed || this.child !== child) return
          completed = true
          clearTimeout(timer)
          this.url = url
          this.setStatus('running')
          resolve(url)
        })()
      }
      const timer = setTimeout(() => {
        child.kill()
        finishWithError('官方 DSH 在规定时间内未返回本地访问地址')
      }, timeoutMs)
      child.stdout.on('data', consume)
      child.stderr.on('data', consume)
      child.once('error', () => finishWithError('无法启动官方 DSH 进程'))
      child.once('exit', (code) => {
        clearTimeout(timer)
        this.child = null
        this.url = null
        if (!completed) finishWithError(`官方 DSH 启动失败（退出码 ${code ?? 'unknown'}）`)
        else {
          this.status = code === 0 ? 'idle' : 'failed'
          this.emit('status', this.status)
        }
      })
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      this.url = null
      this.setStatus('idle')
      return
    }
    this.setStatus('stopping')
    await new Promise<void>((resolve) => {
      let finished = false
      const done = (): void => {
        if (finished) return
        finished = true
        clearTimeout(forceTimer)
        resolve()
      }
      const forceTimer = setTimeout(() => {
        child.kill('SIGKILL')
        done()
      }, 5_000)
      child.once('exit', done)
      child.kill('SIGTERM')
    })
    this.child = null
    this.url = null
    this.setStatus('idle')
  }

  private setStatus(status: RuntimeStatus): void {
    this.status = status
    this.emit('status', status)
  }
}
