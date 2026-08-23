# 启动失败诊断与修复规格

状态：已批准（2026-08-24）
目标版本：v0.2.0（功能版本；本规格不包含发布和打标签）

## 假设与已确认决策

1. 目标用户是 Windows 11 上不熟悉命令行的 Harness 用户。
2. 每次用户启动最多进行一轮自动修复和一次重试，不进入循环。
3. 启动器托管的 Harness 可执行修复；外部安装只诊断，不写入。
4. 程序文件损坏时优先原版本事务性重装，不静默升级。
5. 插件冲突修复使用可回滚隔离，不自动删除插件或插件数据。
6. 配置修复前创建排除凭据的备份；API Key、Token、`.env`、凭据文件和密钥文件永不读取、备份、恢复或写入诊断报告。
7. 默认修复模式为“自动安全修复”，并提供“修复前询问”和“仅诊断”。

## 目标

为 DSH Desktop 增加启动前体检和失败后修复能力，使普通用户在插件冲突、托管安装损坏或启动环境异常时无需命令行即可恢复本机 Harness，同时保证所有自动修改可追踪、可回滚且不会触碰凭据。

核心用户流程：

1. 用户点击“启动 DSH”。
2. 管理器对托管安装执行快速体检，然后正常启动。
3. 启动失败时，管理器生成结构化诊断，只对高置信度且可回滚的故障执行一次修复。
4. 管理器只重试一次，并在本地地址出现后完成存活和 HTTP 健康验证。
5. 修复成功时显示处理结果；插件被隔离时允许保持禁用、重新启用或在来源明确时确认卸载。
6. 修复和重试仍失败时停止，恢复本轮临时修改，并显示可复制的脱敏报告。

## 非目标

- 不修复账号、API Key、Token、`.env` 或 `.credentials.*`。
- 不静默升级 Harness 或插件。
- 不自动卸载插件，不执行无限重试或无置信度的猜测式修改。
- 不写入项目依赖、PATH 来源不明安装或其他只读外部安装。
- 不尝试修改杀毒软件、防火墙、Windows 安全策略或管理员权限。
- 不在 v0.2.0 构建通用插件市场或完整插件管理器。

## 技术栈

- Electron 43、React 19、TypeScript 7、Vite/electron-vite。
- Zod 用于 IPC、持久化状态和修复动作参数校验。
- Vitest 用于单元与集成测试，现有打包 E2E 用于 Windows 安装包验证。
- 不新增运行时依赖。隔离补丁写成 JSON 数组；JSON 是 Harness 补丁解析器可接受的 YAML 子集。

## 命令

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run audit:boundary
npm run verify
npm run test:official
npm run package:win:x64
npm run test:packaged
```

## 设计

### 启动状态机

```text
idle
  -> preflight
  -> starting
  -> running

starting/preflight failure
  -> diagnosing
  -> awaiting-confirmation | repairing | failed
  -> retrying (最多一次)
  -> recovered | failed
```

每轮启动生成一个 `repairId`。持久化记录原始选择、诊断分类、动作、重试次数和待恢复文件；应用异常退出后，下一次初始化先恢复未完成事务。

### 启动前体检

仅对托管的 bundled/installed 版本执行：

- 重新验证版本目录、官方包身份和 CLI 入口。
- 验证内置 Node 和运行命令路径。
- 执行官方 `dsh web --dump-config`，捕获配置解析、模块解析和插件树组合错误，不激活插件。
- 对比最后一次成功启动保存的 Profile/Bundle/依赖清单及配置文件哈希。
- 检查上次由 DSH Desktop 记录的子进程是否残留；只有 PID、可执行文件路径和命令入口全部匹配时才允许处理。

外部安装跳过会引发写入的体检，只复用启动输出分类和诊断报告。

### 故障分类

`RepairDiagnosis` 至少包含：

- `category`: `plugin-conflict`、`plugin-missing`、`plugin-config`、`managed-install-corrupt`、`stale-process`、`runtime-unhealthy`、`sensitive-config`、`external-installation`、`unknown`。
- `confidence`: `high`、`medium`、`low`。
- `summary`: 面向用户的脱敏说明。
- `evidence`: 有界、脱敏的错误特征，不包含完整环境或配置正文。
- `candidate`: 可选的插件 entry id、包名、Profile 或配置层。
- `action`: 可选的白名单修复动作。

只有规则精确匹配、目标位于允许范围且动作可回滚时才能标记为自动修复。凭据/认证错误、外部安装和未知错误永不自动修复。

### 最后一次可用状态

成功通过稳定性检查后保存：

- Harness 精确版本和来源。
- Web Profile 的依赖名称与版本、Bundle 顺序和插件 entry id/包名映射。
- `package.json`、Profile `cordis.patch.yml`、Home `cordis.patch.yml` 的存在状态、大小、修改时间和 SHA-256。
- 有效配置转储的 SHA-256；不保存配置正文。

采集范围采用路径白名单，明确排除 `.env`、credentials、sessions、密钥以及其他未知文件。

### 插件隔离

不修改用户原始 Patch，也不调用 `plugin remove` 作为自动修复。管理器在自身 `userData` 下生成临时隔离补丁，并在重试时通过 `--patch` 传入：

```json
[
  { "id": "suspect-plugin", "disabled": true }
]
```

自动隔离必须满足：

- entry id 来自官方配置转储或已验证的最后可用基线，不来自未经校验的自由文本。
- 故障日志明确指向该 entry，或该 entry 是最后成功启动后唯一新增/更新的第三方插件。
- 隔离前创建 `pre-repair` 配置备份并写入修复事务。
- 重试失败时撤销本轮隔离；重试成功时保留为“待用户决定”。

用户可执行：

- 保持禁用：将隔离补丁标记为持久启用，后续启动继续应用。
- 重新启用：停用隔离补丁并再次启动验证；失败时恢复隔离。
- 卸载：仅当包名可映射到所选 Profile 的直接依赖时启用，显示明确确认后调用当前精确 Harness 的官方插件删除流程。无法证明来源时不提供卸载。

### 托管版本修复

安装损坏时使用与安装流程相同的包身份、版本和 CLI 校验：

1. 下载或使用已缓存的同一精确版本到 staging 目录。
2. 完成校验后，将现有目录移动到事务备份位置。
3. 原子提交新目录并启动验证。
4. 验证失败时恢复旧目录；成功后清理事务备份。

网络不可用且无可用缓存时停止并显示原因，不升级到其他版本。

### 启动成功判定

获得 `127.0.0.1` URL 后仍需：

- 子进程在可注入的稳定窗口内保持存活，生产默认 2 秒。
- 对严格验证过的回环 URL 发起有超时的 HTTP 请求并得到响应。
- 验证期间退出或请求失败时按 `runtime-unhealthy` 处理。

### 修复模式

- `auto`（默认）：高置信度白名单动作自动执行；其他动作等待确认或只报告。
- `ask`：所有会写入状态或文件的修复先确认。
- `diagnose`：不执行任何修复动作。

### UI

主窗口复用现有状态栏与错误详情，新增可折叠的“启动修复”区域：

- 当前阶段：正在检查、正在诊断、正在修复、正在重试、修复成功或未修复。
- 已检查项目和判定原因。
- 实际执行的动作和是否已回滚。
- 插件隔离后的“保持禁用 / 重新启用 / 卸载”操作。
- “复制诊断报告”和“打开诊断日志”。
- 修复模式设置；按钮具备文字标签、键盘焦点和忙碌/禁用状态。

## 项目结构

```text
src/main/repair/                 修复分类、基线、事务、插件隔离和编排
src/main/controller.ts          将修复编排接入现有启动流程
src/main/dsh-supervisor.ts      配置体检参数、受控启动和稳定性检查
src/main/version-manager.ts     精确版本事务性修复
src/shared/contracts.ts         修复状态和 IPC 数据契约
src/main/ipc.ts                 修复模式与隔离决策 IPC
src/preload/index.ts            安全暴露修复动作
src/renderer/                   修复状态、确认和结果 UI
tests/                          对应单元与集成测试
tasks/                          实施计划与清单
```

## 代码风格

延续现有 TypeScript、Zod 边界校验和小型显式状态对象，不引入通用规则 DSL：

```ts
export function mayAutoRepair(diagnosis: RepairDiagnosis, mode: RepairMode): boolean {
  return mode === 'auto'
    && diagnosis.confidence === 'high'
    && diagnosis.action !== null
    && diagnosis.action.reversible
}
```

- 文件名使用 kebab-case，类型和类使用 PascalCase，函数和变量使用 camelCase。
- 修复动作使用封闭联合类型，不执行从日志直接拼接出的命令或路径。
- 注释解释安全边界和非显而易见的 Harness 行为，不复述代码。

## 测试策略

- 小型单元测试：错误分类、置信度、路径边界、entry id/包名校验、脱敏和状态转换。
- 文件系统集成测试：最后可用基线、隔离补丁、事务中断恢复、重试失败回滚、精确版本修复。
- 控制器集成测试：一轮修复和一次重试、外部安装只读、敏感配置不修复。
- Supervisor 测试：配置转储、参数顺序、稳定窗口和 HTTP 健康检查。
- 渲染层测试：不同修复状态的文案与按钮可用性。
- Windows 打包 E2E：假 CLI 首次因插件冲突失败，隔离后启动成功；未知错误停止且可复制报告。

所有行为测试遵循先失败再实现。每个增量至少运行目标测试，检查点运行 `npm run verify`，最终运行官方和打包 E2E。

## 可观测性

需要回答：

1. 这次启动为何失败，被归到哪一类？
2. 自动修复执行了什么，是否回滚，重试是否成功？
3. 是否存在修复循环或外部安装被写入？
4. 报告是否排除了敏感数据？

使用现有 JSONL 诊断日志记录稳定事件名：`repair-started`、`repair-diagnosed`、`repair-action`、`repair-retry`、`repair-completed`、`repair-rolled-back`。每条记录包含 `repairId`，只记录枚举、版本、来源、插件 id/包名和有界脱敏摘要，不记录环境、配置正文或用户目录内容。

## 安全边界

### 始终执行

- IPC、持久化记录、插件 id、包名、版本、路径和修复决策均在主进程校验。
- 文件目标解析为绝对路径并验证处于管理器 `userData`、托管版本根或明确的 Profile 白名单内。
- 写操作使用 staging、原子写入、完整性校验和可恢复事务。
- 诊断先脱敏再持久化或发送给渲染进程。
- 自动修复使用动作白名单，并强制 `repairAttempts <= 1`、`retryAttempts <= 1`。

### 先询问用户

- 卸载插件。
- 中等置信度的配置层隔离。
- 恢复旧备份或对用户配置进行实际覆盖。
- 新增依赖、修改 CI 或扩大外部安装写权限。

### 永不执行

- 读取、复制、散列、记录或修改凭据和环境文件。
- 将错误文本、插件名或文件内容直接传入 shell。
- 对外部只读安装执行修复、卸载或递归删除。
- 绕过包身份、版本、入口、符号链接和目录边界校验。

## 验收标准

1. 已知插件冲突能被分类为高置信度，自动创建排除凭据的备份、隔离一个明确插件并只重试一次。
2. 隔离后成功启动时，GUI 显示目标插件和“保持禁用 / 重新启用 / 卸载”；无法证明直接依赖时禁用卸载并说明原因。
3. 隔离后仍失败时，本轮临时隔离自动撤销，状态进入 `failed`，且不会再次修复或重试。
4. 未知错误、敏感配置错误和外部安装失败不会触发写操作。
5. 托管版本损坏时原版本事务性重装；失败可恢复旧目录，不选择其他版本。
6. 管理器在修复中断后能于下次启动恢复未完成事务。
7. 启动成功必须同时满足进程稳定窗口和回环 HTTP 健康检查。
8. 诊断报告列出检查、分类、动作和结果，复制内容及落盘日志不含测试植入的密钥、Token、代理认证或凭据正文。
9. 所有现有测试继续通过，新增行为有测试覆盖，`npm run verify`、`npm run test:official` 和 `npm run test:packaged` 通过。

## 开放问题

无阻塞问题。插件隔离采用启动器拥有的 `--patch` Overlay，避免直接改写用户 YAML；若目标 Harness 版本不支持该参数，则降级为只诊断，不自动修改用户 Patch。
