import {
  exactVersionSchema,
  pluginEntryIdSchema,
  pluginPackageNameSchema,
  type RepairCandidate,
  type RepairDiagnosis,
  type RepairMode
} from '../../shared/contracts'
import { redactDiagnostic } from '../diagnostic-logger'

type RepairSource = 'bundled' | 'installed' | 'external'

export interface StartupFailureInput {
  message: string
  source: RepairSource
  version: string
}

const evidenceLimit = 1_000

function safeEntryId(message: string): string | undefined {
  const patterns = [
    /\bduplicate\s+entry\s+id\s+["']([^"']+)["']/i,
    /\bentry(?:\s+id)?\s*(?:=|:)\s*["']([^"']+)["']/i,
    /\bentry\s+["']([^"']+)["']/i
  ]
  for (const pattern of patterns) {
    const candidate = pattern.exec(message)?.[1]
    const parsed = pluginEntryIdSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }
  return undefined
}

function safePackageName(message: string): string | undefined {
  const patterns = [
    /\bCannot find package\s+["']([^"']+)["']/i,
    /\b(?:from\s+package|plugin|from|package)\s+["']?(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)["']?/i
  ]
  for (const pattern of patterns) {
    const candidate = pattern.exec(message)?.[1]
    const parsed = pluginPackageNameSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }
  return undefined
}

function evidence(message: string): string[] {
  return [redactDiagnostic(message).slice(0, evidenceLimit)]
}

function pluginCandidate(message: string): RepairCandidate | null {
  const entryId = safeEntryId(message)
  const packageName = safePackageName(message)
  return entryId || packageName ? { ...(entryId ? { entryId } : {}), ...(packageName ? { packageName } : {}) } : null
}

function diagnoseManagedFailure(message: string, version: string): RepairDiagnosis {
  const safeMessage = redactDiagnostic(message).slice(0, evidenceLimit)
  const details = evidence(safeMessage)

  if (/\.credentials(?:\.ya?ml)?|\bcredential(?:s)?\b|\b(?:api[_-]?key|token|password|secret|authorization)\s*=/i.test(safeMessage)) {
    return {
      category: 'sensitive-config', confidence: 'high',
      summary: '检测到凭据或敏感环境配置错误，管理器不会读取或修改这些内容。',
      evidence: details, candidate: null, action: null
    }
  }

  if (/\b(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND)\b|Cannot find (?:package|module)/i.test(safeMessage)) {
    const candidate = pluginCandidate(safeMessage)
    return {
      category: 'plugin-missing', confidence: 'medium',
      summary: candidate?.packageName ? `插件依赖 ${candidate.packageName} 无法解析。` : '插件或模块依赖无法解析。',
      evidence: details, candidate, action: null
    }
  }

  if (/官方 DSH CLI 入口无效|DSH CLI entry is invalid|ENOENT[^\n]*(?:dsh|cli)|找不到[^\n]*(?:DSH|CLI)[^\n]*入口/i.test(safeMessage)) {
    const parsedVersion = exactVersionSchema.safeParse(version)
    return {
      category: 'managed-install-corrupt', confidence: parsedVersion.success ? 'high' : 'low',
      summary: parsedVersion.success ? `托管的 Harness ${parsedVersion.data} 程序文件不完整。` : '托管的 Harness 程序文件不完整。',
      evidence: details, candidate: null,
      action: parsedVersion.success
        ? { kind: 'reinstall-managed-version', version: parsedVersion.data, reversible: true, requiresConfirmation: false }
        : null
    }
  }

  if (/cordis\.patch\.ya?ml|failed to (?:read|parse) (?:patches|overlay)|patch(?:es)?[^\n]*(?:must be an array|parse|invalid)|YAMLException/i.test(safeMessage)) {
    const layer = /profiles[\\/]web[\\/]cordis\.patch\.ya?ml/i.test(safeMessage) ? 'profile' : 'home'
    return {
      category: 'plugin-config', confidence: 'high',
      summary: `Harness 的${layer === 'profile' ? ' Web Profile' : '全局'}插件配置层无效。`,
      evidence: details, candidate: { layer },
      action: { kind: 'quarantine-config-layer', layer, reversible: true, requiresConfirmation: true }
    }
  }

  if (/duplicate\s+entry\s+id|already\s+(?:has|registered|provided)|service[^\n]*another provider|plugin tree failed|unresolved plugin|failed plugin/i.test(safeMessage)) {
    const candidate = pluginCandidate(safeMessage)
    const entryId = candidate?.entryId
    const packageName = candidate?.packageName ?? null
    return {
      category: 'plugin-conflict', confidence: entryId ? 'high' : 'medium',
      summary: entryId ? `插件条目 ${entryId} 与当前插件树冲突。` : '检测到插件树冲突，但无法唯一确定需要隔离的插件。',
      evidence: details, candidate,
      action: entryId
        ? { kind: 'quarantine-plugin', entryId, packageName, reversible: true, requiresConfirmation: false }
        : null
    }
  }

  if (/规定时间内未返回本地访问地址|local address|health check|ECONNREFUSED|socket hang up/i.test(safeMessage)) {
    return {
      category: 'runtime-unhealthy', confidence: 'medium',
      summary: 'Harness 进程未能通过本机启动健康检查。',
      evidence: details, candidate: null, action: null
    }
  }

  return {
    category: 'unknown', confidence: 'low',
    summary: '启动失败，但当前规则无法安全确定修复方式。',
    evidence: details, candidate: null, action: null
  }
}

export function diagnoseStartupFailure(input: StartupFailureInput): RepairDiagnosis {
  const diagnosis = diagnoseManagedFailure(input.message, input.version)
  if (input.source !== 'external') return diagnosis
  return {
    ...diagnosis,
    category: 'external-installation',
    summary: `外部 Harness 启动失败：${diagnosis.summary}`,
    action: null
  }
}

export function mayAutoRepair(diagnosis: RepairDiagnosis, mode: RepairMode): boolean {
  return mode === 'auto'
    && diagnosis.confidence === 'high'
    && diagnosis.action !== null
    && diagnosis.action.reversible
    && !diagnosis.action.requiresConfirmation
}
