# DSH Desktop Project Rules

## Product boundary

- This repository builds a Windows 11 x64 desktop manager for the official `@deepseek-ai/dsh` package.
- Never fork, patch, rebuild, inject into, or import private modules from official Harness.
- The manager owns its bundled runtime, managed exact-version installs, application state, transaction journals, and manager-created backups. It never owns an external package directory.
- API keys and credentials remain inside official Harness. The manager must not display, log, back up, restore, or delete them.

## Runtime and security invariants

- Preserve the runtime chain: Electron main process -> bundled Node.js -> official DSH CLI -> `http://127.0.0.1:<port>` -> isolated Harness window.
- Spawn only validated absolute executables and CLI paths with `shell: false`.
- Accept only loopback HTTP URLs with an explicit port and a successful health check.
- Keep Electron renderers sandboxed with `nodeIntegration: false` and `contextIsolation: true`.
- Privileged operations stay in the main process behind the typed preload bridge and validated IPC inputs.
- External and project-local Harness installs remain read-only unless a verified npm-global install is explicitly selected for management.
- Backups use an allowlist and exclude credentials, environment files, key material, symlinks, and unknown roots.

## Repository layout

```text
src/main/       Electron lifecycle and privileged services
src/preload/    Typed renderer bridge
src/renderer/   Sandboxed management UI
src/shared/     IPC contracts and validation schemas
scripts/        Windows build, packaging, and smoke checks
tests/          Behavior and security regression tests
docs/           Product specification and release guide
build/          Reviewed Windows packaging assets
```

Generated `out/`, `release/`, `build-resources/`, `artifacts/`, and `node_modules/` content is never source.

## Change rules

- Keep changes small and preserve unrelated work.
- Add focused tests for behavior changes and denial paths.
- Keep Simplified Chinese and English application text behaviorally equivalent.
- Run `npm run verify` before completion.
- Run `npm run test:official` after changing the bundled runtime, Harness boundary, package installation, or CLI startup.
- Build with `npm run package:win:x64` and run `npm run test:packaged` after packaging or packaged UI changes.
- Report only checks actually run.

## Release rules

- Keep `package.json` and `package-lock.json` versions synchronized with `npm run version:set -- x.y.z`.
- Release tags are exactly `vx.y.z` and require a matching `CHANGELOG.md` section.
- Windows installers are currently unsigned; release notes must disclose possible SmartScreen warnings and publish SHA-256 checksums.
