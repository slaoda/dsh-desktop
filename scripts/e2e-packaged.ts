import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function findExecutable(directory: string): Promise<string | null> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (process.platform === 'darwin' && target.endsWith(path.join('DSH Desktop.app'))) {
      return path.join(target, 'Contents', 'MacOS', 'DSH Desktop')
    }
    if (process.platform === 'win32' && entry.isFile() && entry.name === 'DSH Desktop.exe') return target
    if (entry.isDirectory()) {
      const found = await findExecutable(target)
      if (found) return found
    }
  }
  return null
}

const executablePath = await findExecutable(path.join(root, 'release'))
if (!executablePath) throw new Error('release 目录中没有找到已打包的 DSH Desktop')
const resourcesPath = process.platform === 'darwin'
  ? path.resolve(executablePath, '..', '..', 'Resources')
  : path.join(path.dirname(executablePath), 'resources')
const packagedNode = process.platform === 'win32'
  ? path.join(resourcesPath, 'runtime', 'node.exe')
  : path.join(resourcesPath, 'runtime', 'bin', 'node')
const packagedNpm = process.platform === 'win32'
  ? path.join(resourcesPath, 'runtime', 'npm', 'bin', 'npm-cli.js')
  : path.join(resourcesPath, 'runtime', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
const packagedPnpm = path.join(resourcesPath, 'package-manager', 'pnpm', 'bin', 'pnpm.mjs')
const packagedRuntimeBin = path.join(resourcesPath, 'runtime-bin')
const packagedPnpmCommand = path.join(packagedRuntimeBin, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
const packagedDshCommand = path.join(packagedRuntimeBin, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
const packagedDshEntry = path.join(resourcesPath, 'dsh', '0.1.1-rc.2', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(packagedNode) || !existsSync(packagedNpm) || !existsSync(packagedPnpm) || !existsSync(packagedPnpmCommand) || !existsSync(packagedDshCommand) || !existsSync(packagedDshEntry)) {
  throw new Error(`打包应用的运行资源不完整：node=${existsSync(packagedNode)}, npm=${existsSync(packagedNpm)}, pnpm=${existsSync(packagedPnpm)}, pnpmCommand=${existsSync(packagedPnpmCommand)}, dshCommand=${existsSync(packagedDshCommand)}, dshEntry=${existsSync(packagedDshEntry)}`)
}

const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
const packagedEnvironment = {
  ...process.env,
  [pathKey]: [packagedRuntimeBin, path.dirname(packagedNode), process.env[pathKey]].filter(Boolean).join(path.delimiter),
  DSH_DESKTOP_NODE: packagedNode,
  DSH_DESKTOP_DSH_ENTRY: packagedDshEntry
}
const packagedPnpmVersion = await new Promise<string>((resolve, reject) => {
  const executable = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm --version'] : ['--version']
  const command = spawn(executable, args, { env: packagedEnvironment, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  command.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  command.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  command.once('error', reject)
  command.once('exit', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`打包 pnpm 退出码 ${code}: ${stderr}`)))
})
if (packagedPnpmVersion !== '11.22.0') throw new Error(`打包 pnpm 版本不正确：${packagedPnpmVersion}`)
const packagedDshVersion = await new Promise<string>((resolve, reject) => {
  const executable = process.platform === 'win32' ? 'cmd.exe' : 'dsh'
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'dsh --version'] : ['--version']
  const command = spawn(executable, args, { env: packagedEnvironment, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  command.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  command.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  command.once('error', reject)
  command.once('exit', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`打包 dsh 退出码 ${code}: ${stderr}`)))
})
if (packagedDshVersion !== '0.1.1-rc.2') throw new Error(`打包 dsh 版本不正确：${packagedDshVersion}`)
const isolatedHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-desktop-e2e-'))
const removableVersion = '0.0.1'
const failingVersion = '0.0.2'
const removablePackageRoot = path.join(isolatedHome, 'electron', 'dsh-versions', removableVersion, 'node_modules', '@deepseek-ai', 'dsh')
const failingPackageRoot = path.join(isolatedHome, 'electron', 'dsh-versions', failingVersion, 'node_modules', '@deepseek-ai', 'dsh')
await mkdir(removablePackageRoot, { recursive: true })
await mkdir(failingPackageRoot, { recursive: true })
await writeFile(path.join(removablePackageRoot, 'package.json'), JSON.stringify({
  name: '@deepseek-ai/dsh', version: removableVersion, bin: { dsh: 'cli.js' }
}))
await writeFile(path.join(removablePackageRoot, 'cli.js'), 'throw new Error("E2E removable version must not launch")\n')
await writeFile(path.join(failingPackageRoot, 'package.json'), JSON.stringify({
  name: '@deepseek-ai/dsh', version: failingVersion, bin: { dsh: 'cli.js' }
}))
await writeFile(path.join(failingPackageRoot, 'cli.js'), 'console.error("Error: packaged DSH startup fixture failed")\nprocess.exit(1)\n')
const launchEnvironment: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: path.join(isolatedHome, 'official-dsh') }
if (process.platform === 'darwin') {
  for (const key of Object.keys(launchEnvironment)) {
    if (key.toLowerCase() === 'path') delete launchEnvironment[key]
  }
  launchEnvironment.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
}
const electronApp = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${path.join(isolatedHome, 'electron')}`],
  env: { ...launchEnvironment, ELECTRON_ENABLE_LOGGING: '1' }
})
async function waitForStartAtLogin(expected: boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await electronApp.evaluate(({ app }) => app.getLoginItemSettings().openAtLogin) === expected) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(expected ? '开机启动设置未写入 Windows' : '关闭开机启动后 Windows 设置仍然存在')
}
async function waitForCheckboxState(locator: { isChecked(): Promise<boolean> }, expected: boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await locator.isChecked() === expected) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('开机启动复选框未同步主进程状态')
}
const applicationProcess = electronApp.process()
let applicationOutput = ''
const collectOutput = (chunk: Buffer | string): void => {
  applicationOutput = `${applicationOutput}${chunk.toString()}`.slice(-8_000)
}
applicationProcess.stdout?.on('data', collectOutput)
applicationProcess.stderr?.on('data', collectOutput)

try {
  let dshWindow
  try {
    dshWindow = await electronApp.firstWindow({ timeout: 45_000 })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`打包应用未能打开窗口（退出码 ${applicationProcess.exitCode ?? 'unknown'}）：${reason}\n${applicationOutput}`)
  }
  await dshWindow.waitForLoadState('domcontentloaded')
  const hasOfficialBootstrap = await dshWindow.evaluate(() => '__DSH_BOOT__' in window)
  if (!hasOfficialBootstrap) throw new Error('DSH 窗口缺少官方启动标记')
  const managerPromise = electronApp.waitForEvent('window', { timeout: 10_000 })
  await electronApp.evaluate(({ app, Menu }) => {
    if (app.name !== 'DSH Desktop') throw new Error(`应用名称不正确：${app.name}`)
    if (process.platform === 'darwin' && Menu.getApplicationMenu()?.items[0]?.label !== 'DSH Desktop') {
      throw new Error(`macOS 应用菜单名称不正确：${Menu.getApplicationMenu()?.items[0]?.label ?? 'missing'}`)
    }
    if (!Menu.getApplicationMenu()?.getMenuItemById('about-dsh-desktop')) throw new Error('关于菜单不存在')
    if (!Menu.getApplicationMenu()?.getMenuItemById('check-for-updates')) throw new Error('应用更新菜单不存在')
    const item = Menu.getApplicationMenu()?.getMenuItemById('version-manager')
    if (!item?.click) throw new Error('版本管理菜单不存在')
    if (!item.icon || (typeof item.icon !== 'string' && item.icon.isEmpty())) throw new Error('版本管理菜单图标不存在')
    item.click(item, undefined, undefined)
  })
  const manager = await managerPromise
  await manager.getByRole('heading', { name: /版本管理|Version Manager/ }).waitFor()
  await manager.getByRole('heading', { name: /^DSH\s+\d+\.\d+\.\d+/ }).waitFor()
  await manager.getByRole('button', { name: /全部版本|All versions/ }).waitFor()
  const installVersion = process.env.DSH_DESKTOP_E2E_INSTALL_VERSION
  if (installVersion) {
    const targetRow = manager.locator('article.version-row').filter({ hasText: installVersion })
    await targetRow.waitFor({ timeout: 30_000 })
    await targetRow.getByRole('button', { name: /安装|Install/ }).click()
    await targetRow.getByText(/已安装|Installed/, { exact: true }).waitFor({ timeout: 300_000 })
  }
  const removableRow = manager.locator('article.version-row').filter({ has: manager.getByText(removableVersion, { exact: true }) })
  await removableRow.waitFor()
  const uninstallButton = removableRow.getByRole('button', { name: /卸载|Uninstall/ })
  await uninstallButton.waitFor()
  manager.once('dialog', (dialog) => { void dialog.accept() })
  await uninstallButton.click()
  await manager.getByText(removableVersion, { exact: true }).waitFor({ state: 'detached' })
  if (existsSync(path.join(isolatedHome, 'electron', 'dsh-versions', removableVersion))) throw new Error('卸载后版本目录仍然存在')
  await manager.getByText(/npm 官方源|Official npm registry/).waitFor()
  await manager.getByRole('heading', { name: /^DSH\s+\d+\.\d+\.\d+/ }).waitFor()
  await manager.getByRole('button', { name: /在 GitHub 查看并 Star 项目|View on GitHub and star the project/ }).waitFor()
  const languageSwitch = manager.getByRole('button', { name: /切换为英文|切换为中文/ })
  await languageSwitch.waitFor()
  const initialSwitchLabel = await languageSwitch.getAttribute('aria-label')
  await languageSwitch.click()
  if (initialSwitchLabel === '切换为英文') {
    await manager.getByRole('heading', { name: 'Version Manager' }).waitFor()
    await manager.getByRole('button', { name: '切换为中文' }).click()
    await manager.getByRole('heading', { name: '版本管理' }).waitFor()
  } else {
    await manager.getByRole('heading', { name: '版本管理' }).waitFor()
    await manager.getByRole('button', { name: '切换为英文' }).click()
    await manager.getByRole('heading', { name: 'Version Manager' }).waitFor()
  }
  if (process.env.DSH_DESKTOP_E2E_SCREENSHOT) {
    await manager.getByRole('heading', { name: /^DSH\s+\d+\.\d+\.\d+/ }).waitFor({ timeout: 20_000 })
    await manager.screenshot({ path: process.env.DSH_DESKTOP_E2E_SCREENSHOT, fullPage: true })
  }
  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle().startsWith('DeepSeek Harness'))
    if (!window) throw new Error('找不到 Harness 窗口')
    window.close()
    if (window.isVisible()) throw new Error('关闭到托盘后 Harness 窗口仍然可见')
  })
  await manager.getByText(/DSH 运行中|DSH running/, { exact: true }).waitFor({ timeout: 10_000 })
  await manager.getByRole('button', { name: /停止|Stop/, exact: true }).click()
  await manager.getByText(/未运行|Not running/, { exact: true }).waitFor({ timeout: 10_000 })
  await electronApp.evaluate(({ BrowserWindow }) => {
    if (BrowserWindow.getAllWindows().some((candidate) => candidate.getTitle().startsWith('DeepSeek Harness'))) {
      throw new Error('停止 Harness 后陈旧运行窗口仍然存在')
    }
  })
  if (process.platform === 'win32') {
    const startAtLogin = manager.getByRole('checkbox', { name: /开机启动|Start at login/ })
    await startAtLogin.click()
    await waitForStartAtLogin(true)
    await waitForCheckboxState(startAtLogin, true)
    await startAtLogin.click()
    await waitForStartAtLogin(false)
    await waitForCheckboxState(startAtLogin, false)
  }
  const failingRow = manager.locator('article.version-row').filter({ has: manager.getByText(failingVersion, { exact: true }) })
  await failingRow.getByRole('button', { name: /切换|Switch/ }).click()
  const runtimeAlert = manager.getByRole('alert')
  await runtimeAlert.getByText(/官方 DSH 启动失败|Official DSH failed to start/, { exact: true }).waitFor()
  await runtimeAlert.getByText('Error: packaged DSH startup fixture failed', { exact: true }).waitFor()
  if (await manager.locator('.footer .error-message').count()) throw new Error('启动错误仍然显示在底部状态栏')
  await runtimeAlert.getByRole('button', { name: /查看详情|View details/ }).click()
  await runtimeAlert.locator('pre').getByText(/packaged DSH startup fixture failed/).waitFor()
  await runtimeAlert.getByRole('button', { name: /复制错误|Copy error/ }).click()
  await runtimeAlert.getByRole('button', { name: /已复制|Copied/ }).waitFor()
  const copiedError = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  if (!copiedError.includes('packaged DSH startup fixture failed')) throw new Error(`复制的启动错误不正确：${copiedError}`)
  if (process.env.DSH_DESKTOP_E2E_SCREENSHOT) await manager.screenshot({ path: process.env.DSH_DESKTOP_E2E_SCREENSHOT, fullPage: true })
  console.log('Packaged E2E passed: selected dsh CLI, bundled pnpm, direct official DSH launch, version removal, manager UI, close-to-tray, runtime error details, clipboard copy, and explicit stop')
} finally {
  try { await electronApp.evaluate(({ app }) => app.setLoginItemSettings({ openAtLogin: false })) } catch { /* The app may already be closed. */ }
  await electronApp.close()
  await rm(isolatedHome, { recursive: true, force: true })
}
