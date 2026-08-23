<div align="center">
  <img src="build/icon-source.svg" width="96" alt="DSH Desktop 图标">
  <h1>DSH Desktop</h1>
  <p>面向 Windows 11 的 DeepSeek Harness 一键安装与版本管理工具。</p>
</div>

DSH Desktop 自带 Node.js、pnpm 和经过校验的官方 `@deepseek-ai/dsh`，普通用户无需准备开发环境即可使用。

> 本项目由社区独立维护，与 DeepSeek 官方无隶属关系。管理器不修改官方 Harness。

## 功能

- Windows 11 x64 图形化安装程序，支持自定义安装目录。
- 安装、保留、切换和卸载指定 Harness 版本。
- 稳定版、预览版和全部版本三个渠道。
- 检测本机已有 Harness；验证通过的独立或全局安装可原地管理，项目依赖保持只读。
- 更新前备份、候选版本健康检查、失败回滚和中断恢复。
- 启动失败诊断与一次安全修复：可处理明确的插件冲突和托管版本损坏，并支持自动、先询问、仅诊断三种模式。
- 配置或配置加会话的选择性备份与恢复，凭据始终排除。
- 系统代理、无凭据手动代理和自定义 npm 镜像。
- 托盘运行、关闭到托盘、开机启动和脱敏诊断日志。
- 简体中文与 English 界面。

## 安装与使用

1. 运行 `DSH-Desktop-Setup-<版本>-x64.exe`。
2. 如 SmartScreen 提示未知发布者，核对发布页 SHA-256 后选择“更多信息 -> 仍要运行”。
3. 启动 DSH Desktop；内置 Harness 可直接运行。
4. 从应用菜单或托盘打开“版本管理”，安装或切换其他版本。
5. API Key 和模型设置只在官方 Harness 页面中填写。

Harness 只监听 `127.0.0.1`，不会暴露到局域网。Harness 更新由用户在版本管理器中触发；管理器自身当前不提供自动更新。

### 启动修复

启动失败后，版本管理器会显示“启动修复”卡片和脱敏诊断报告。默认模式只对高置信度、可回滚的问题执行一轮修复和一次重试；也可以在“桌面设置”中改为“修复前询问”或“仅诊断”。

明确的插件冲突会通过启动器自己的 Overlay 暂时禁用插件，不改写 Harness 原始配置。恢复成功后可选择保持禁用、重新启用，或在包来源能被证明且再次确认后卸载。重新启用失败会恢复隔离；自动修复不会卸载插件。

托管版本文件损坏时只重装同一精确版本，不静默升级。外部安装、凭据/认证错误和未知故障只提供诊断，不执行写操作。API Key、Token、`.env`、凭据和密钥文件不会进入备份、修复报告或日志。

## 安全边界

- 官方 Harness 在独立的沙箱窗口中运行，不获得 Electron 或管理器 IPC 权限。
- 安装后校验官方包名、精确版本和 CLI 入口。
- 外部路径、URL、版本号、包清单和 IPC 数据均在主进程重新校验。
- 管理器不记录、备份或恢复 API Key、Token、`.env` 和密钥文件。
- 每次启动最多执行一轮白名单修复和一次重试；所有修复动作带事务记录并可在失败或中断后恢复。
- 卸载托管版本不会删除 Harness 用户目录。

完整规则见 [Windows 管理器规格](docs/WINDOWS_MANAGER_SPEC.md)。

## 开发

开发环境需要 Windows x64 和 Node.js 22.19+：

```bash
npm ci
npm run prepare:runtime
npm run dev
```

常用验证命令：

```bash
npm run verify
npm run test:official
npm run package:win:x64
npm run test:packaged
```

构建资源位于被 Git 忽略的 `build-resources/`，安装包输出到 `release/`。发布步骤见 [发布指南](docs/RELEASING.md)。

## 许可证

桌面管理器代码使用 [MIT License](LICENSE)。官方 Harness 及其依赖按各自许可证运行。
