# Windows Harness Manager Specification

English | [简体中文](WINDOWS_MANAGER_SPEC.zh-CN.md)

Status: approved for implementation

## Goal

Turn DSH Desktop into a safe, one-click Windows 11 x64 manager for non-technical DeepSeek Harness users. The application installs its own runtime, keeps multiple official Harness versions, detects eligible existing installations, and makes updates recoverable.

## Product scope

- Ship a graphical Windows `.exe` installer with a user-selectable application directory.
- Bundle Node.js and the package manager. Normal use must not require a terminal, system Node.js, npm, or pnpm.
- Bind Harness only to `127.0.0.1`; never expose it to the LAN.
- Let the user install, keep, switch, launch, stop, and uninstall exact official Harness versions.
- Offer Stable, Preview, and All versions. Installing or switching is always an explicit user action.
- Detect independent/global existing Harness installations and manage them in place after explicit confirmation. Project-local dependencies are visible but read-only.
- Keep application uninstall separate from Harness-version uninstall. Never remove a running version.
- Support system proxy, an optional manual proxy, and an optional custom npm-compatible registry.
- Show download progress, retry recoverable failures, and verify the downloaded official package before publication.
- Provide close-to-tray and optional start-at-login behavior.

## Recoverable updates

Before a version switch that can affect user data, the manager creates a backup of the selected Harness home. It excludes credential files and retains the latest three automatic/manual backups by default. A candidate version is launched and health-checked before the selection is committed. If startup fails, the previous version remains selected and can be relaunched. Interrupted transactions are detected on the next start.

Known migrations may run only from an allowlisted migration identifier implemented by the manager. Unknown breaking changes require an explicit warning; no downloaded package can provide or execute a manager migration script.

Restore supports configuration-only and configuration-plus-session modes. Restore never copies credentials.

## Existing-installation ownership policy

An installation is manageable only when all of these are true:

1. Its package manifest identifies the exact official `@deepseek-ai/dsh` package and a valid semantic version.
2. Its CLI entry resolves inside that package root.
3. It is an independent installation selected by the user or a verified global npm installation.
4. The manager invokes the resolved absolute CLI with the bundled Node.js and `shell: false`.

Project-local dependencies and ambiguous PATH entries are reported as read-only. In-place uninstall is available only for a verified global npm installation and uses the matching package manager's explicit global uninstall operation. The manager never recursively deletes an external package root.

## Data and security boundaries

- API keys are entered in the official Harness UI and are never bundled, displayed, logged, backed up, or restored by the manager.
- Filesystem paths, versions, URLs, IPC input, package manifests, and process output are untrusted and validated in the main process.
- Registry URLs must use HTTP or HTTPS and contain no embedded credentials. Official package identity and version are verified after installation.
- Logs redact credentials and proxy authentication. Diagnostic logs, transaction journals, backups, and managed versions live in application-owned data directories.
- A disk-space preflight runs before installation and backup.
- Uninstall and restore actions require explicit confirmation in the GUI.

## Primary user flows

1. First launch detects the environment, shows any existing installations, and recommends a version channel.
2. The user chooses an application-managed version or explicitly selects an eligible existing installation.
3. Launch waits for the loopback health check, opens the official Harness UI, and guides first-time API-key setup there.
4. Update creates a backup, installs without replacing the old version, health-checks the candidate, and commits the switch only on success.
5. Failure leaves the old selection and backup intact and presents a concise recovery action.

## Acceptance criteria

- A clean Windows 11 x64 machine can install and launch Harness without a preinstalled runtime.
- Stable/Preview/All catalogs classify prereleases correctly and exact-version installation remains possible.
- A failed candidate launch cannot replace the selected working version.
- A running version cannot be uninstalled.
- Credential fixtures never appear in backup output or logs.
- Project-local detections cannot be selected for destructive management.
- The packaged app binds only to `127.0.0.1`, survives an interrupted install/update, and passes the repository verification and packaged smoke tests.

## Initial delivery slices

1. Version channels, registry settings, and persisted policy.
2. Transactional switch with journal and health-check commit.
3. Safe backup inventory, retention, and selective restore.
4. Existing-install discovery and ownership classification.
5. Windows management UI, tray/startup controls, diagnostics, and installer verification.

