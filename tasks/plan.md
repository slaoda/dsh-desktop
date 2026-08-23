# Windows Harness Manager implementation plan

Spec: `docs/WINDOWS_MANAGER_SPEC.md`

## Architecture

- Keep Electron main as the privileged composition layer and the official Harness UI isolated.
- Extend shared contracts with channel, network, backup, transaction, and external-install types.
- Keep each policy independently testable in focused main-process modules.
- Persist only validated preferences and transaction references in `desktop-state.json`.
- Commit a version switch only after the supervisor reports a healthy loopback URL.

## Ordered slices

1. Baseline and specification
   - Run existing tests and verification.
   - Add the approved bilingual specification and proposed Decision Note.
2. Version policy
   - Add Stable/Preview/All catalog derivation and registry URL validation.
   - Persist settings and expose validated IPC actions.
   - Add regression and denial-path tests.
3. Transactional switching
   - Add an atomic transaction journal.
   - Start candidate before persisting selection; preserve prior selection on failure.
   - Recover stale journals on initialization.
4. Backup lifecycle
   - Add allowlisted backup categories, credential exclusions, manifests, retention, disk checks, and selective restore.
   - Connect manual backup and update-triggered backup to controller/IPC.
5. Existing installations
   - Discover explicit, global npm, PATH, and project-local candidates.
   - Validate official package identity and classify manageability.
   - Allow launch/select only under policy; allow uninstall only through verified global package-manager operation.
6. Windows UX
   - Add channel/network/environment/backup controls and confirmations.
   - Add tray, close-to-tray, start-at-login, logs, and recovery notices.
7. Release hardening
   - Run `npm run verify`, `npm run test:official`, build Windows x64 NSIS, and run packaged smoke tests.
   - Perform repository-specific code/security review and resolve findings.

## Delivery policy

- Implement tests before behavior for each slice.
- Keep commits atomic and leave generated output uncommitted.
- Do not modify `F:/codex/deepseek` or an existing Harness home during development tests; use temporary fixtures only.

