import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type {
  BackupReason,
  BackupScope,
  RepairDiagnosis,
  RepairMode,
  RepairSessionSummary
} from '../../shared/contracts'
import type { DshStartOptions } from '../dsh-supervisor'
import type { ResolvedDsh } from '../version-manager'
import type { RepairBaselineStore } from './repair-baseline'
import { findUniquePluginChange } from './repair-baseline'
import { diagnoseStartupFailure, mayAutoRepair } from './repair-diagnosis'
import type { DshPreflightResult } from './dsh-preflight'
import type { PluginQuarantineStore, QuarantineRecord } from './plugin-quarantine'
import type { RepairTransactionStore } from './repair-transaction'

interface RepairSupervisor {
  start(dsh: ResolvedDsh, options?: DshStartOptions): Promise<string>
}

interface RepairPreflight {
  inspect(dsh: ResolvedDsh, overlay: string | null): Promise<DshPreflightResult>
}

interface RepairBackups {
  hasSource(): Promise<boolean>
  create(reason: BackupReason, scope: BackupScope): Promise<unknown>
}

export interface RepairEngineDependencies {
  supervisor: RepairSupervisor
  preflight: RepairPreflight
  baselines: RepairBaselineStore
  quarantine: PluginQuarantineStore
  transactions: RepairTransactionStore
  backups: RepairBackups | null
}

export interface RepairLaunchResult {
  url: string
  session: RepairSessionSummary
}

export class RepairLaunchError extends Error {
  constructor(message: string, readonly session: RepairSessionSummary, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RepairLaunchError'
  }
}

function newSession(): RepairSessionSummary {
  return {
    id: randomUUID(), phase: 'preflight', outcome: null, diagnosis: null, actions: [],
    repairAttempts: 0, retryAttempts: 0, quarantinedPlugin: null
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '启动失败'
}

export class RepairEngine extends EventEmitter {
  constructor(private readonly dependencies: RepairEngineDependencies) {
    super()
  }

  async recoverInterrupted(): Promise<boolean> {
    return await this.dependencies.transactions.recover(this.dependencies.quarantine)
  }

  async launch(dsh: ResolvedDsh, mode: RepairMode): Promise<RepairLaunchResult> {
    let session = this.publish(newSession())
    const initialOverlay = await this.dependencies.quarantine.overlayPath()
    let inspection: DshPreflightResult | null = null
    let failure: unknown
    try {
      inspection = await this.dependencies.preflight.inspect(dsh, initialOverlay)
      session = this.publish({ ...session, phase: 'starting' })
      const url = await this.dependencies.supervisor.start(dsh, { repairOverlay: initialOverlay })
      await this.captureSuccessfulBaseline(dsh, inspection)
      session = this.publish({ ...session, phase: 'completed', outcome: 'not-needed' })
      return { url, session }
    } catch (error) {
      failure = error
    }

    session = this.publish({ ...session, phase: 'diagnosing' })
    let diagnosis = diagnoseStartupFailure({ message: errorMessage(failure), source: dsh.source, version: dsh.version })
    diagnosis = await this.resolveBaselineCandidate(diagnosis, dsh, inspection)
    session = this.publish({ ...session, diagnosis })

    if (!mayAutoRepair(diagnosis, mode)) {
      const awaiting = diagnosis.action !== null && (mode === 'ask' || diagnosis.action.requiresConfirmation)
      session = this.publish({
        ...session,
        phase: awaiting ? 'awaiting-confirmation' : 'failed',
        outcome: awaiting ? 'awaiting-confirmation' : 'failed'
      })
      throw new RepairLaunchError(`${diagnosis.summary} ${diagnosis.evidence[0] ?? ''}`.trim(), session, { cause: failure })
    }

    if (diagnosis.action?.kind !== 'quarantine-plugin') {
      session = this.publish({ ...session, phase: 'failed', outcome: 'failed' })
      throw new RepairLaunchError(`尚不支持自动执行修复动作：${diagnosis.action?.kind ?? 'unknown'}`, session, { cause: failure })
    }

    return await this.quarantineAndRetry(dsh, inspection, diagnosis, session, failure)
  }

  private async quarantineAndRetry(
    dsh: ResolvedDsh,
    _inspection: DshPreflightResult | null,
    diagnosis: RepairDiagnosis,
    originalSession: RepairSessionSummary,
    originalFailure: unknown
  ): Promise<RepairLaunchResult> {
    const action = diagnosis.action
    if (!action || action.kind !== 'quarantine-plugin') throw new Error('插件隔离动作无效')
    let session = originalSession
    let transactionStarted = false
    let actionApplied = false
    try {
      if (!this.dependencies.backups || !await this.dependencies.backups.hasSource()) throw new Error('无法创建启动修复安全备份')
      await this.dependencies.backups.create('pre-repair', 'configuration')
      const previous = await this.dependencies.quarantine.find(action.entryId)
      if (previous) throw new Error('该插件已经处于隔离状态，不能重复自动修复')
      await this.dependencies.transactions.beginPluginQuarantine({
        repairId: session.id,
        entryId: action.entryId,
        packageName: action.packageName,
        previous
      })
      transactionStarted = true
      session = this.publish({ ...session, phase: 'repairing', repairAttempts: 1 })
      const record = await this.dependencies.quarantine.activate({ entryId: action.entryId, packageName: action.packageName })
      actionApplied = true
      await this.dependencies.transactions.mark('applied')
      session = this.publish({
        ...session,
        quarantinedPlugin: record,
        actions: [{ kind: 'quarantine-plugin', target: action.entryId, status: 'applied', summary: `已临时隔离插件 ${action.entryId}` }]
      })
      const overlay = await this.dependencies.quarantine.overlayPath()
      if (!overlay) throw new Error('插件隔离 Overlay 未通过完整性检查')
      const repairedInspection = await this.dependencies.preflight.inspect(dsh, overlay)
      await this.dependencies.transactions.mark('retrying')
      session = this.publish({ ...session, phase: 'retrying', retryAttempts: 1 })
      const url = await this.dependencies.supervisor.start(dsh, { repairOverlay: overlay })
      await this.dependencies.transactions.complete()
      await this.captureSuccessfulBaseline(dsh, repairedInspection)
      session = this.publish({ ...session, phase: 'recovered', outcome: 'recovered' })
      return { url, session }
    } catch (repairError) {
      if (transactionStarted) await this.dependencies.transactions.recover(this.dependencies.quarantine)
      const actions = actionApplied
        ? [{ kind: 'quarantine-plugin' as const, target: action.entryId, status: 'rolled-back' as const, summary: `插件 ${action.entryId} 的临时隔离已回滚` }]
        : [{ kind: 'quarantine-plugin' as const, target: action.entryId, status: 'failed' as const, summary: `未能隔离插件 ${action.entryId}` }]
      session = this.publish({
        ...session,
        phase: 'failed', outcome: 'failed', actions, quarantinedPlugin: null
      })
      throw new RepairLaunchError(
        `${diagnosis.summary} 自动修复未成功：${errorMessage(repairError)}`,
        session,
        { cause: originalFailure }
      )
    }
  }

  private async resolveBaselineCandidate(
    diagnosis: RepairDiagnosis,
    dsh: ResolvedDsh,
    inspection: DshPreflightResult | null
  ): Promise<RepairDiagnosis> {
    if (diagnosis.category !== 'plugin-conflict' || diagnosis.action || dsh.source === 'external' || inspection?.status !== 'passed' || inspection.effectiveConfig === null) return diagnosis
    const previous = await this.dependencies.baselines.read()
    if (!previous) return diagnosis
    try {
      const current = await this.dependencies.baselines.snapshot({
        version: dsh.version, source: dsh.source, effectiveConfig: inspection.effectiveConfig, entries: inspection.entries
      })
      const candidate = findUniquePluginChange(previous, current)
      if (!candidate) return diagnosis
      return {
        ...diagnosis,
        confidence: 'high',
        summary: `最后一次成功启动后只有插件 ${candidate.entryId} 发生变化。`,
        candidate,
        action: {
          kind: 'quarantine-plugin', entryId: candidate.entryId, packageName: candidate.packageName,
          reversible: true, requiresConfirmation: false
        }
      }
    } catch {
      return diagnosis
    }
  }

  private async captureSuccessfulBaseline(dsh: ResolvedDsh, inspection: DshPreflightResult): Promise<void> {
    if (dsh.source === 'external' || inspection.status !== 'passed' || inspection.effectiveConfig === null) return
    try {
      await this.dependencies.baselines.capture({
        version: dsh.version, source: dsh.source, effectiveConfig: inspection.effectiveConfig, entries: inspection.entries
      })
    } catch {
      // A diagnostic baseline must never turn a healthy Harness launch into a failure.
    }
  }

  private publish(session: RepairSessionSummary): RepairSessionSummary {
    this.emit('session', session)
    return session
  }
}
