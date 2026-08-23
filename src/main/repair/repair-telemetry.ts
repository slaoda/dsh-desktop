import type { DiagnosticLevel } from '../diagnostic-logger'
import type { RepairSessionSummary } from '../../shared/contracts'

export interface RepairDiagnosticRecord {
  level: DiagnosticLevel
  event: 'repair-started' | 'repair-diagnosed' | 'repair-action' | 'repair-retry' | 'repair-completed' | 'repair-rolled-back'
  data: Record<string, unknown>
}

function eventFor(session: RepairSessionSummary): RepairDiagnosticRecord['event'] {
  if (session.phase === 'preflight' || session.phase === 'starting') return 'repair-started'
  if (session.phase === 'diagnosing' || session.phase === 'awaiting-confirmation') return 'repair-diagnosed'
  if (session.phase === 'repairing') return 'repair-action'
  if (session.phase === 'retrying') return 'repair-retry'
  if (session.phase === 'failed' && session.actions.some((action) => action.status === 'rolled-back')) return 'repair-rolled-back'
  return 'repair-completed'
}

export function repairDiagnosticRecord(
  session: RepairSessionSummary,
  version: string | null,
  external: boolean
): RepairDiagnosticRecord {
  return {
    level: session.phase === 'failed' ? 'error' : session.phase === 'awaiting-confirmation' ? 'warn' : 'info',
    event: eventFor(session),
    data: {
      repairId: session.id,
      phase: session.phase,
      outcome: session.outcome,
      version,
      external,
      category: session.diagnosis?.category ?? null,
      confidence: session.diagnosis?.confidence ?? null,
      summary: session.diagnosis?.summary ?? null,
      evidence: session.diagnosis?.evidence ?? [],
      actions: session.actions.map((action) => ({
        kind: action.kind,
        target: action.target,
        status: action.status,
        summary: action.summary
      })),
      repairAttempts: session.repairAttempts,
      retryAttempts: session.retryAttempts,
      quarantinedPlugin: session.quarantinedPlugin
        ? {
            entryId: session.quarantinedPlugin.entryId,
            packageName: session.quarantinedPlugin.packageName,
            disposition: session.quarantinedPlugin.disposition
          }
        : null
    }
  }
}
