# 启动修复任务清单

## 任务 1：确认规格和计划

**说明：** 将已确认需求写成可测试规格、依赖计划和小任务清单。

**验收：**
- [x] `docs/STARTUP_REPAIR_SPEC.md` 覆盖目标、命令、结构、风格、测试、安全边界和成功标准。
- [x] `tasks/plan.md` 包含依赖图、检查点、风险与缓解。
- [x] 用户明确批准规格和任务范围。

**验证：** 文档审阅。
**依赖：** 无。
**文件：** `docs/STARTUP_REPAIR_SPEC.md`、`tasks/plan.md`、`tasks/todo.md`。
**范围：** 中。

## 任务 2：修复契约与分类规则

**说明：** 先用失败测试定义修复状态、诊断类别、置信度和自动修复白名单。

**验收：**
- [x] 插件冲突、缺失插件、配置错误、敏感配置、安装损坏、外部和未知错误分类稳定。
- [x] 只有高置信度可回滚动作在 `auto` 模式可自动执行。
- [x] 所有摘要先脱敏并限制长度。

**验证：** `npm test -- tests/repair-diagnosis.test.ts`、`npm run typecheck`。
**依赖：** 任务 1。
**文件：** `src/shared/contracts.ts`、`src/main/repair/repair-diagnosis.ts`、`tests/repair-diagnosis.test.ts`。
**范围：** 中。

## 任务 3：最后一次成功基线

**说明：** 保存允许范围内的插件/Profile 元数据和哈希，用于定位成功启动后的唯一变化。

**验收：**
- [x] 只对白名单 Profile/配置文件采集元数据和 SHA-256。
- [x] `.env`、credentials、sessions、密钥和未知路径不会被读取或记录。
- [x] 损坏或旧 schema 基线安全忽略，不阻止启动。

**验证：** `npm test -- tests/repair-baseline.test.ts`。
**依赖：** 任务 2。
**文件：** `src/main/repair/repair-baseline.ts`、`tests/repair-baseline.test.ts`、`src/main/harness-home.ts`。
**范围：** 中。

## 任务 4：插件隔离与事务恢复

**说明：** 用管理器拥有的 Overlay 隔离已验证 entry id，并在失败或中断时恢复。

**验收：**
- [x] Overlay 使用原子写入并只包含校验过的 `id` 与 `disabled: true`。
- [x] 修复事务在动作前落盘，完成后清除，初始化可恢复未完成事务。
- [x] 用户原始 `cordis.patch.yml` 和插件数据不被修改。

**验证：** `npm test -- tests/plugin-quarantine.test.ts tests/repair-transaction.test.ts`。
**依赖：** 任务 2、3。
**文件：** `src/main/repair/plugin-quarantine.ts`、`src/main/repair/repair-transaction.ts`、`tests/plugin-quarantine.test.ts`、`tests/repair-transaction.test.ts`。
**范围：** 中。

## 任务 5：配置体检与稳定启动

**说明：** 为托管版本增加官方配置转储预检，并在 URL 出现后验证进程稳定和回环 HTTP 响应。

**验收：**
- [x] `--dump-config` 使用精确 DSH 入口、`shell: false`、私有运行环境和超时。
- [x] 隔离 Overlay 参数只接受管理器生成的绝对路径。
- [x] 进程提前退出或回环 HTTP 无响应不会标记为成功。

**验证：** `npm test -- tests/dsh-preflight.test.ts tests/dsh-supervisor.test.ts`。
**依赖：** 任务 4。
**文件：** `src/main/repair/dsh-preflight.ts`、`src/main/dsh-supervisor.ts`、`tests/dsh-preflight.test.ts`、`tests/dsh-supervisor.test.ts`。
**范围：** 中。

## 任务 6：单轮 RepairEngine 与 Controller 接入

**说明：** 编排体检、首次启动、诊断、一次修复、一次重试和回滚，并把状态放入快照。

**验收：**
- [x] 自动模式最多一轮修复和一次重试；询问和只诊断模式符合定义。
- [x] 外部、敏感和未知错误不会调用写动作。
- [x] 重试失败撤销本轮临时动作并输出完整状态。

**验证：** `npm test -- tests/repair-engine.test.ts tests/controller.test.ts`。
**依赖：** 任务 2–5。
**文件：** `src/main/repair/repair-engine.ts`、`src/main/controller.ts`、`tests/repair-engine.test.ts`、`tests/controller.test.ts`、`src/main/index.ts`。
**范围：** 中。

## 任务 7：精确版本事务性重装

**说明：** 修复托管安装文件时重新获取同一版本，在 staging 校验后原子替换并支持回滚。

**验收：**
- [x] 只允许当前托管精确版本，不接受替代版本或外部路径。
- [x] 新安装校验失败或启动重试失败时恢复原目录。
- [x] 无网络和缓存时报告失败，不改变当前安装。

**验证：** `npm test -- tests/version-repair.test.ts tests/version-manager.test.ts`。
**依赖：** 任务 6。
**文件：** `src/main/version-manager.ts`、`src/main/repair/managed-version-repair.ts`、`tests/version-repair.test.ts`、`tests/version-manager.test.ts`。
**范围：** 中。

## 任务 8：插件隔离决策

**说明：** 实现保持禁用、重新启用验证和来源明确时的确认卸载。

**验收：**
- [x] 重新启用失败会恢复隔离，成功则移除隔离状态。
- [x] 卸载只接受 Profile 的直接依赖包名，并复用精确 DSH 和私有 pnpm 环境。
- [x] 卸载始终由用户确认；不可证明来源时拒绝。

**验证：** `npm test -- tests/plugin-repair-actions.test.ts`。
**依赖：** 任务 6。
**文件：** `src/main/repair/plugin-repair-actions.ts`、`src/main/repair/plugin-quarantine.ts`、`tests/plugin-repair-actions.test.ts`、`src/main/controller.ts`。
**范围：** 中。

## 任务 9：IPC 与 Preload 契约

**说明：** 将修复模式、确认修复和插件决策通过严格校验的 Electron IPC 暴露给 UI。

**验收：**
- [x] 所有 channel、枚举、id 和决策参数由主进程 Zod 校验。
- [x] Renderer 不能传任意路径、命令或插件包名执行修复。
- [x] DesktopApi 类型与实现一致。

**验证：** `npm test -- tests/controller.test.ts`、`npm run typecheck`。
**依赖：** 任务 6、8。
**文件：** `src/shared/ipc-channels.ts`、`src/shared/contracts.ts`、`src/main/ipc.ts`、`src/preload/index.ts`。
**范围：** 中。

## 任务 10：修复 GUI

**说明：** 在现有窗口中显示修复阶段、诊断摘要、动作、结果、模式设置和插件决策。

**验收：**
- [ ] 错误、修复中、修复成功、等待确认和失败状态都有明确文字。
- [ ] 所有操作使用原生按钮/表单，键盘可达且忙碌时正确禁用。
- [ ] 详情默认折叠，复制报告经过主进程脱敏边界。

**验证：** `npm test -- tests/runtime-error.test.ts tests/repair-copy.test.ts`、`npm run build`，开发运行手工检查。
**依赖：** 任务 9。
**文件：** `src/renderer/src.tsx`、`src/renderer/style.css`、`src/renderer/copy.ts`、`tests/repair-copy.test.ts`。
**范围：** 中。

## 任务 11：诊断、安全回归与文档

**说明：** 补齐带 `repairId` 的结构化事件、敏感信息植入测试和使用说明。

**验收：**
- [x] 每个修复会话可从日志重建分类、动作、重试和回滚结果。
- [x] 日志及复制报告不包含测试密钥、Token、代理认证或配置正文。
- [x] README 说明自动修复边界、模式和插件隔离行为。

**验证：** `npm test -- tests/diagnostic-logger.test.ts tests/repair-report.test.ts`、`npm run audit:boundary`。
**依赖：** 任务 6、10。
**文件：** `src/main/diagnostic-logger.ts`、`tests/diagnostic-logger.test.ts`、`tests/repair-report.test.ts`、`README.md`、`docs/WINDOWS_MANAGER_SPEC.md`。
**范围：** 中。

## 任务 12：打包 E2E 与 v0.2.0 准备

**说明：** 验证 Windows 安装包中的插件冲突修复和未知错误停止路径，准备但不发布 v0.2.0。

**验收：**
- [ ] 打包假 CLI 首次冲突失败、隔离后成功且只重试一次。
- [ ] 未知错误不修复，用户可复制报告和打开日志。
- [ ] 版本与 changelog 准备为 v0.2.0；不创建标签、不推送 Release。

**验证：** `npm run verify`、`npm run test:official`、`npm run package:win:x64`、`npm run test:packaged`。
**依赖：** 任务 1–11。
**文件：** `scripts/e2e-packaged.ts`、相关 `tests/fixtures/`、`package.json`、`CHANGELOG.md`。
**范围：** 中。
