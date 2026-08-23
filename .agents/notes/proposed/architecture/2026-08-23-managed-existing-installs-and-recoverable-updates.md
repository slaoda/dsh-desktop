# Decision: Manage eligible existing installs and recoverable updates

Status: proposed
Category: architecture

## Problem

The original desktop boundary owns only application-managed Harness versions and deliberately does not read Harness user data. The Windows manager product requires in-place management of eligible existing installations and recoverable updates that back up configuration and sessions. Implementing either without an explicit ownership model could delete external files, expose credentials, or commit a broken version switch.

## Proposal

Add two narrow, opt-in capabilities:

1. Detect external installations, validate the official package manifest and contained CLI, and classify them by origin. Project-local and ambiguous PATH entries remain read-only. Only a verified npm-global installation can be uninstalled, and uninstall delegates to the matching package manager instead of deleting directories.
2. Back up a user-confirmed Harness home through allowlisted categories while always excluding credentials. Keep at most three backups by default. Treat version switching as a journaled transaction and persist the candidate selection only after loopback health succeeds.

Downloaded packages never provide migration code. Known migrations are manager-owned, allowlisted operations; unknown breaking changes require an explicit warning.

## Acceptance criteria

- Detection cannot make a project-local package destructively manageable.
- External CLI resolution cannot escape the validated package root.
- Credentials cannot enter backups, restores, diagnostics, or logs.
- Failed candidate startup leaves the previous selection committed.
- Stale journals are detected without deleting user data.
- The main process revalidates every IPC path, URL, mode, and installation identifier.

## Alternatives considered

- Continue managing only application-owned versions. This is safer but does not meet the approved in-place-management requirement.
- Import external installations into application storage. This duplicates large packages and contradicts the requested in-place behavior.
- Let each downloaded version run its own migration scripts. This crosses the trust boundary and permits unreviewed code to modify user data.
- Back up the entire Harness home. This risks copying API keys and unrelated user files.

## Risks

- Harness data layout may change, requiring conservative category allowlists and clear partial-backup reporting.
- Global package-manager discovery differs across Windows environments.
- Backup size and available disk space may vary significantly.
- The root product-boundary instructions and audit gates must be revised only when the corresponding behavior and tests are implemented.

