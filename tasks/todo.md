# Windows Harness Manager acceptance checklist

- [x] Requirements consolidated and assumptions recorded.
- [x] Existing baseline passes before behavior changes.
- [ ] Version channels classify stable and prerelease versions correctly.
- [ ] Registry/proxy input is validated and credentials are rejected/redacted.
- [ ] Failed candidate startup preserves the previous selected version.
- [ ] Interrupted switch transaction is recoverable.
- [ ] Automatic and manual backups exclude credentials and retain three copies.
- [ ] Selective restore supports configuration-only and sessions.
- [ ] Existing installations are detected and ownership-classified.
- [ ] Project-local installations are read-only.
- [ ] Running versions cannot be uninstalled.
- [ ] GUI exposes the supported flows in Simplified Chinese and English.
- [ ] Windows installer allows a custom application directory.
- [ ] Tray/start-at-login behavior works on Windows 11.
- [ ] `npm run verify` passes.
- [ ] Official Harness smoke test passes.
- [ ] Windows x64 installer builds and packaged smoke test passes.
- [ ] Final code/security review has no unresolved high-severity findings.
