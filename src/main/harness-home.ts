import path from 'node:path'

// Mirrors the documented DSH home precedence without importing Harness internals.
// Source: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/home-paths/README.md
export function resolveHarnessHome(
  environment: NodeJS.ProcessEnv,
  userHome: string
): string {
  const paths = path.win32
  const configured = environment.DSH_HOME?.trim()
  if (!configured) return paths.join(userHome, '.dsh')
  if (configured === '~') return paths.normalize(userHome)
  if (configured.startsWith('~/') || configured.startsWith('~\\')) {
    return paths.join(userHome, configured.slice(2))
  }
  if (!paths.isAbsolute(configured)) throw new Error('DSH_HOME 必须是绝对路径或使用 ~/ 前缀')
  return paths.normalize(configured)
}
