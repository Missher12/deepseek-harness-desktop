# Desktop candidate validation

The Desktop workflows build an immutable candidate once per workflow run. Its descriptor binds the source SHA, platform, validation mode, artifact basename, artifact byte count, artifact SHA-256, and product-input SHA-256. Every consumer verifies those externally supplied values against physical regular files before executing the candidate.

## Quick validation

Quick mode runs the critical compile and safety contracts, builds one Windows Setup, installs it silently into an isolated location, and opens the installed Electron application. A bounded Playwright check requires the real Desktop body surface and exactly one sidebar, center, and details column before the application quits normally. The gate then requires the complete recorded Windows process tree to reach zero.

Quick mode does not claim the pinned baseline comparison, visible NSIS pages, DPI and tray coverage, the complete packaged smoke, performance sampling, or the full uninstall and data-preservation lifecycle. Its best-effort uninstall in cleanup is hygiene only, not an acceptance result. The 6–9 minute duration is an engineering target rather than a relaxed test contract.

## Full validation

Full mode consumes the same immutable Setup in parallel jobs. It retains the visible NSIS Welcome, Destination, Progress, and Finish pages, shortcut checks, the complete packaged smoke, 100% and 150% native visual coverage, five cold and five warm startup samples, installed inventory, uninstall and data preservation, and complete process cleanup. The performance comparison first verifies the pinned 0.5.2 Setup byte count and SHA-256.

## Candidate reuse

A successfully built candidate may be reused by rerunning failed consumer jobs only within the same GitHub Actions run and the same source SHA. Every new commit, including changes limited to tests or scripts, requires a new workflow run and a newly built candidate. A descriptor from an older run cannot establish the identity of new source.

## Release validation

The Desktop Release workflow rebuilds both platform artifacts from the tag SHA in full mode. It never downloads a candidate from an earlier manual validation run. Windows and macOS share the candidate descriptor and validation-mode vocabulary, while each platform owner remains responsible for its native build and lifecycle evidence.

The executable contracts live in the [Windows Desktop workflow](../../.github/workflows/windows-desktop.yml), the [Desktop Release workflow](../../.github/workflows/desktop-release.yml), and the [candidate descriptor CLI](../../scripts/desktop-candidate-descriptor.ts).
