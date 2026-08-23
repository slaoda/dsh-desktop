import type { AppSnapshot } from '../shared/contracts'

const REPORT_LIMIT = 4_096

export function redactRepairReportText(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*@/gi, '$1[REDACTED]@')
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:access_token|api[_-]?key|token|secret|password)=)[^\s&#]*/gi, '$1[REDACTED]')
    .replace(/\b(password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret)\b(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[REDACTED]')
}

export function formatRepairReport(snapshot: AppSnapshot): string {
  const lines = [
    'DSH Desktop startup repair report',
    `appVersion: ${snapshot.appVersion}`,
    `dshVersion: ${snapshot.selectedVersion ?? 'none'}`,
    `runtimeStatus: ${snapshot.runtimeStatus}`,
    `repairMode: ${snapshot.repairMode}`
  ]
  const session = snapshot.repairSession
  if (!session) {
    lines.push('repairSession: none')
  } else {
    lines.push(
      `repairId: ${session.id}`,
      `phase: ${session.phase}`,
      `outcome: ${session.outcome ?? 'none'}`,
      `repairAttempts: ${session.repairAttempts}`,
      `retryAttempts: ${session.retryAttempts}`
    )
    if (session.diagnosis) {
      lines.push(
        `category: ${session.diagnosis.category}`,
        `confidence: ${session.diagnosis.confidence}`,
        `summary: ${session.diagnosis.summary}`
      )
      for (const evidence of session.diagnosis.evidence) lines.push(`evidence: ${evidence}`)
    }
    for (const action of session.actions) {
      lines.push(`action: ${action.kind} | ${action.target} | ${action.status} | ${action.summary}`)
    }
    if (session.quarantinedPlugin) {
      lines.push(
        `quarantinedPlugin: ${session.quarantinedPlugin.entryId}`,
        `pluginDisposition: ${session.quarantinedPlugin.disposition}`
      )
    }
  }
  if (snapshot.error) lines.push(`error: ${snapshot.error}`)
  return redactRepairReportText(lines.join('\n')).slice(0, REPORT_LIMIT)
}
