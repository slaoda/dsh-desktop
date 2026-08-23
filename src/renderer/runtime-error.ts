import type { RuntimeStatus } from '../shared/contracts'

const runtimeFailurePrefixes = [
  '官方 DSH 启动失败（退出码 ',
  '官方 DSH 在规定时间内未返回本地访问地址',
  '无法启动官方 DSH 进程'
]

export function isDshRuntimeFailure(status: RuntimeStatus, error: string | null): error is string {
  if (error === null) return false
  if (status === 'failed' && runtimeFailurePrefixes.some((prefix) => error.startsWith(prefix))) return true
  const isRecoverableSwitchFailure = (status === 'running' || status === 'failed') && error.startsWith('新版本 ') && error.includes('启动失败')
  return isRecoverableSwitchFailure && runtimeFailurePrefixes.some((prefix) => error.includes(prefix))
}

export function dshRuntimeFailureDetail(error: string): string {
  const failureStart = Math.max(...runtimeFailurePrefixes.map((prefix) => error.lastIndexOf(prefix)))
  const separator = error.indexOf('：', Math.max(0, failureStart))
  return separator >= 0 ? error.slice(separator + 1).trim() : ''
}
