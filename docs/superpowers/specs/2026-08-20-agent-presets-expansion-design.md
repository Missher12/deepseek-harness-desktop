# Built-in Agent Presets Expansion Design

English | [中文](2026-08-20-agent-presets-expansion-design.zh.md)

## Status and confirmed decisions

DeepSeek Harness keeps its four existing shipped presets and their stable ids: `standard`, `code`, `minimal`, and `cordis`. This change adds eight more shipped presets. The user selects every preset manually from the existing new-session selector; there is no prompt classifier, automatic router, or mid-session mode switch.

The first delivery targets the internal Intel macOS application only. It does not publish a GitHub release or claim Windows acceptance.

## Goal

Make the Agent preset selector useful for both workflow stages and technical specialties. A selected preset should change how the Agent approaches a task, not merely change the label shown in Settings. Each new preset therefore owns a distinct role contract while retaining the mature Harness composition required for file inspection, local development, planning, testing, Skills, and controlled delegation.

## Existing baseline

The current shipped roster contains:

| Id | Display name | Purpose |
|---|---|---|
| `standard` | Standard mode | Full general-purpose coding Agent |
| `code` | PTC mode | Standard capabilities presented through Code Mode |
| `minimal` | Minimal mode | Persistent Bash and string-replacement editing only |
| `cordis` | Creator mode | Authors and experiments with Agent presets and Cordis compositions |

These ids remain present and retain their behavior. Existing session headers may reference them, and a session's preset is fixed once that session has produced content. Renaming or removing those ids would create needless compatibility risk.

## Approaches considered

### Labels and prompts only

This is the smallest change, but it creates presets that look different while exposing effectively identical working behavior. It also provides no reliable regression surface beyond string assertions. This approach is rejected.

### Eight independent shipped compositions

Each new preset is a normal shipped preset directory with its own `preset.yml` and `agent.cordis.yml`. It follows the repository's existing snapshot model: the composition starts from the known-good standard capability set, then carries a concise shared Codex-style operating contract plus a role-specific contract. Discovery, display, manual selection, session locking, and broken-preset reporting continue to work without a new API. This is the selected approach.

### Automatic routing or preset inheritance

An automatic router would have to classify the first prompt before the session becomes non-empty and would sometimes choose incorrectly. Composition inheritance would require a new runtime format and lifecycle rules that the current preset domain intentionally does not have. Both changes are larger than the requested manual preset installation and are deferred.

## New shipped catalog

| Id | Display name | Primary behavior |
|---|---|---|
| `planner` | Planning | Clarify intent, inspect evidence, compare options, and deliver an executable plan before implementation |
| `frontend` | Frontend and UI | Build polished interfaces with responsive geometry, accessibility, interaction states, and visual verification |
| `backend` | Backend and API | Work on APIs, data models, persistence, compatibility, security boundaries, and focused integration tests |
| `debugger` | Troubleshooting | Reproduce first, isolate root cause, distinguish evidence from inference, then apply the smallest authorized fix |
| `reviewer` | Code review | Review diffs and behavior for correctness, regressions, security, and missing tests; report findings by severity |
| `qa` | Testing and QA | Design risk-based tests, reproduce user flows, record evidence, and separate environment failures from product defects |
| `devops` | DevOps and release | Handle local builds, packaging, CI, deployment preflight, rollback planning, and artifact verification |
| `research` | Documentation and research | Read code and sources, synthesize findings, maintain precise documentation, and mark uncertainty explicitly |

The display order remains deterministic: the existing four presets keep positions 1–4 and the new presets use positions 5–12 in the order above.

## Shared Codex-style operating contract

Every new role uses the same compact engineering discipline:

1. Understand the target, repository instructions, current behavior, and affected data flow before changing files.
2. For non-trivial work, form a short internal plan and keep the change bounded to the requested scope.
3. Prefer evidence over assumptions, preserve unrelated worktree changes, and avoid destructive operations.
4. Verify in proportion to risk and never claim a result that was not observed.
5. Report the outcome, changed surface, tests, and remaining limitations clearly.

The role-specific text follows this shared contract and changes emphasis, sequencing, and mutation policy. It must stay concise enough that switching presets does not add a large recurring prompt cost.

## Role boundaries

`planner` and `reviewer` default to analysis-only behavior. `debugger` diagnoses before fixing, and only edits when the user has asked for a fix. `qa` may create or update test assets when requested but does not silently repair product code during a report-only task. The development roles may edit and test local code. `devops` may build and perform local preflight, but production writes, publication, credential use, and destructive actions still require explicit authority.

These behaviors are Agent contracts, not a security boundary. The current file-system plugin publishes read, write, and edit together, while shell tools can also mutate state. Actual enforcement remains with Harness permission presets, sandbox policy, approval flows, and the user's authorization. The UI and documentation must not call a prompt-governed role "read-only" as if it were technically incapable of writing.

## Architecture and files

Each new built-in preset lives at:

```text
packages/preset/agent-presets/presets/<id>/preset.yml
packages/preset/agent-presets/presets/<id>/agent.cordis.yml
```

`preset.yml` contains only the localized shipped display metadata and numeric order. `agent.cordis.yml` is a self-contained composition, consistent with the current no-inheritance design. No persistence schema, gateway method, preload bridge, or React component is added. The existing roster discovers the directories, the current Settings cards display them, and the current new-session chip applies the user's manual selection.

The eight compositions keep the standard preset's stable local-development services unless the role has a concrete reason to omit one. Role differences live primarily in the persona contract, with tool removal used only where it improves the model surface without pretending to enforce security. A catalog regression test records each preset's expected plugin ids so later changes to `standard` do not silently leave eight stale snapshots.

## Data flow

1. Desktop staging copies the shipped preset root into the packaged application.
2. The Agent preset roster discovers all twelve directories and reads their metadata.
3. Settings and the new-session chip render the existing ordered roster.
4. The user manually selects one preset for the next session.
5. Before the session produces content, the host composes that preset and records its id in durable session state.
6. The session keeps that composition for its lifetime; changing the default affects only later sessions.

No automatic classifier reads user prompts, and no existing conversation is migrated.

## Failure handling

Existing discovery and mount behavior remains authoritative. A malformed new composition appears as a broken built-in preset and cannot be selected. A mount failure rolls back the attempted session composition rather than removing the previous standing preset. If one new role is invalid, the original four still remain independently discoverable.

The packaged build must fail its preset catalog test if an expected directory, metadata file, composition file, unique id, or unique order is missing. Installation follows the existing recoverable desktop process: close the running app, preserve a timestamped backup, replace the application, compare packaged bytes, and launch the installed path.

## Verification

Source tests cover:

- discovery of exactly the four existing and eight new shipped ids;
- unique ids, names, and deterministic orders;
- successful parsing and mounting of every new composition;
- the shared operating contract and each role's distinguishing instructions;
- expected plugin catalogs for all eight snapshots;
- manual selection on an empty session and locking after content exists;
- preservation of the four existing presets and their behavior;
- desktop staging of every new preset directory.

UI tests verify that the existing selectors and management cards render the twelve roles without adding an automatic-routing control. A packaged Intel macOS smoke test opens the real application, selects at least one new preset for a blank session, and confirms that the created session reports the selected id. The final internal build is installed only after type checking, linting, focused tests, desktop packaging, and native smoke verification pass.

## Acceptance criteria

1. The existing four preset ids remain available and unchanged.
2. Eight new built-in presets appear in the existing manual selector and Settings management section.
3. The user can select any new preset for a new session without an automatic recommendation or router.
4. Each new preset has a distinct role contract and passes composition validation.
5. Existing sessions, settings, credentials, user-created presets, and chat data remain intact.
6. The final Intel macOS application is backed up, installed to `/Applications/DeepSeek Harness.app`, launched, and verified from that exact path.

## Out of scope

Automatic prompt classification, mid-session preset switching, a new permissions engine, hard read-only enforcement, composition inheritance, a new preset editor, deletion or renaming of the four current presets, Windows packaging, GitHub publication, and public release artifacts are outside this change.
