import { lstat, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { pluginEntryIdSchema, pluginPackageNameSchema } from '../../shared/contracts'
import type { ResolvedDsh } from '../version-manager'
import { runProcess } from '../process-utils'
import { dshChildEnvironment } from '../dsh-supervisor'
import type { PluginBaselineEntry } from './repair-baseline'

const maxOverlayBytes = 262_144
const maxDumpBytes = 2_097_152
const overlaySchema = z.array(z.object({ id: pluginEntryIdSchema, disabled: z.literal(true) }).strict()).max(100)

export interface DshPreflightResult {
  status: 'passed' | 'skipped'
  effectiveConfig: string | null
  entries: PluginBaselineEntry[]
}

function overlayArgument(overlay: string | null): string[] {
  if (overlay === null) return []
  if (!path.isAbsolute(overlay)) throw new Error('插件隔离 Overlay 必须使用绝对路径')
  return ['--patch', overlay]
}

export function dshDumpConfigArguments(dsh: ResolvedDsh, overlay: string | null): string[] {
  return [dsh.entry, 'web', ...overlayArgument(overlay), '--dump-config']
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"')))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function parseDumpedPluginEntries(output: string): PluginBaselineEntry[] {
  const entries = new Map<string, PluginBaselineEntry>()
  let currentId: string | null = null
  for (const line of output.split(/\r?\n/)) {
    const idMatch = /^\s*-\s+id:\s*(.+?)\s*(?:#.*)?$/.exec(line)
    if (idMatch) {
      const parsed = pluginEntryIdSchema.safeParse(unquote(idMatch[1]))
      currentId = parsed.success ? parsed.data : null
      continue
    }
    if (!currentId) continue
    const nameMatch = /^\s+name:\s*(.+?)\s*(?:#.*)?$/.exec(line)
    if (!nameMatch) continue
    const parsedName = pluginPackageNameSchema.safeParse(unquote(nameMatch[1]))
    if (parsedName.success) entries.set(`${currentId}\0${parsedName.data}`, { entryId: currentId, packageName: parsedName.data })
    currentId = null
  }
  return [...entries.values()].sort((a, b) => a.entryId.localeCompare(b.entryId) || a.packageName.localeCompare(b.packageName))
}

export class DshPreflight {
  private readonly repairRoot: string

  constructor(
    private readonly nodePath: string,
    private readonly runtimePathEntries: string[],
    repairRoot: string
  ) {
    this.repairRoot = path.resolve(repairRoot)
  }

  async inspect(dsh: ResolvedDsh, overlay: string | null): Promise<DshPreflightResult> {
    if (dsh.source === 'external') return { status: 'skipped', effectiveConfig: null, entries: [] }
    if (overlay) await this.assertOwnedOverlay(overlay)
    const result = await runProcess(this.nodePath, dshDumpConfigArguments(dsh, overlay), {
      cwd: os.homedir(),
      env: dshChildEnvironment(process.env, dsh, this.nodePath, this.runtimePathEntries),
      timeoutMs: 15_000
    })
    if (Buffer.byteLength(result.stdout, 'utf8') > maxDumpBytes) throw new Error('Harness 配置转储超过安全大小上限')
    return { status: 'passed', effectiveConfig: result.stdout, entries: parseDumpedPluginEntries(result.stdout) }
  }

  private async assertOwnedOverlay(overlay: string): Promise<void> {
    const resolved = path.resolve(overlay)
    const relative = path.relative(this.repairRoot, resolved)
    if (!path.isAbsolute(resolved) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('插件隔离 Overlay 不在管理器修复目录内')
    }
    const info = await lstat(resolved)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('插件隔离 Overlay 必须是普通文件')
    if (info.size > maxOverlayBytes) throw new Error('插件隔离 Overlay 超过安全大小上限')
    overlaySchema.parse(JSON.parse(await readFile(resolved, 'utf8')))
  }
}
