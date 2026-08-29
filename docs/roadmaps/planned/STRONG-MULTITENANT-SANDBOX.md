# Strong Multi-Tenant Sandbox

> Kernel-enforced containment for untrusted tenant agents, with an automatic and reversible migration path for existing Linux OS-user deployments.

**Created**: 2026-08-25
**Status**: Planning
**Target platforms**: Linux hosts with cgroup v2 and namespace support

---

## Problem

Clay's current Linux OS-user mode separates agent processes by UID/GID and uses ACLs to grant project access. This limits accidental cross-user access, but it is not a complete security boundary for hostile agent code.

Tenant processes still share important host surfaces, including network, process visibility, IPC, temporary directories, devices, and parts of the Clay control plane. Resource exhaustion is also not contained. A compromised dependency, CLI, MCP tool, or agent-generated command can therefore threaten other tenants or the root daemon.

Strong isolation must address these gaps without making an existing Linux multi-user installation unusable merely because Clay was upgraded.

## Goals

- Treat authenticated tenant code, project dependencies, agent commands, and MCP tools as untrusted.
- Protect other tenants' projects, homes, sessions, credentials, processes, and integrations.
- Protect the root Clay daemon and host control plane.
- Route every tenant-controlled process through one sandbox boundary.
- Enforce filesystem, process, IPC, network, capability, and resource isolation in the kernel.
- Preserve Clay RBAC independently of OS-level isolation.
- Migrate existing `osUsers` deployments automatically and reversibly before activating the new runtime.
- Keep the currently installed daemon serving while the upgrade helper prepares and validates the migration.
- Run a single strong execution path after cutover, with no compatibility backend in the new daemon.
- Fail closed after cutover; never fall back to daemon privileges or a weaker execution path.

## Non-Goals

- Protect against a malicious host administrator or compromised kernel.
- Live-migrate an already running process into new namespaces.
- Promise that every host distribution can enter enforced mode without installing system dependencies.
- Silently reinterpret existing project visibility, ownership, or sharing policy.

## Non-Negotiable Upgrade Guarantees

These requirements apply to every release that introduces or changes the sandbox:

1. **The new daemon is not activated until migration succeeds.** The old daemon continues serving while discovery, preparation, and shadow validation run.
2. **The new daemon contains only the strong execution path.** Compatibility behavior belongs to the still-running old release, not to a second backend maintained in the new codebase.
3. **Every supported source release migrates directly without manual data recreation or intermediary upgrades.** Clay derives users, mappings, projects, sharing, sessions, homes, credentials, and required runtime policy from the state it already owns.
4. **Missing prerequisites block the upgrade, not the existing service.** The upgrader leaves the old daemon and binary active and reports an actionable requirement.
5. **No destructive mutation occurs before a complete recovery journal exists.** Account mappings, ACLs, ownership, modes, credentials, projects, sessions, and running processes are inventoried first.
6. **Existing valid Linux account mappings, UID/GID values, homes, and credentials are preserved.** Clay must never silently replace or renumber an identity.
7. **Existing project access semantics are materialized before defaults change.** Missing visibility fields are resolved using the old release's effective behavior and written explicitly to the manifest.
8. **Every legacy session remains viewable and receives a deterministic owner before execution.** Clay never guesses at query time and never runs an ownerless session as root.
9. **Running tenant processes are quiesced and terminated as complete process trees before cutover.** They are restarted only inside the strong sandbox.
10. **Migration is resumable and idempotent.** A daemon restart, host reboot, or helper failure resumes from a durable checkpoint without serving a partially migrated runtime.
11. **Cutover is global and atomic.** The installation never serves tenant workloads through old and new execution backends at the same time.
12. **Rollback changes the active release, not the sandbox strength of the new release.** A failed cutover stops the new daemon, restores journaled state, and restarts the retained old binary.
13. **Rollback preserves data created during migration validation and cutover.** Recovery reconciles new files deliberately instead of overwriting them with an older snapshot.
14. **The previous supported Clay release can read migration metadata.** Downgrade cannot corrupt or discard the manifest, checkpoints, or rollback state.
15. **After successful cutover, every sandbox setup failure is fail-closed.** No workload can run with daemon privileges or a weaker backend.

## Threat Model

Assume an authenticated tenant, agent-generated command, project dependency, CLI plugin, network response, or MCP tool becomes malicious.

Protect:

- Other tenants' project files, homes, transcripts, and CLI credentials.
- Clay daemon configuration, auth material, IPC, browser/email integrations, and control APIs.
- Host localhost services, private networks, and cloud metadata endpoints.
- Other tenants and the daemon from CPU, memory, process, file-descriptor, disk, and I/O exhaustion.

Trust:

- The Linux kernel and host administrator.
- The Clay daemon only outside tenant sandboxes.
- Explicit policy and short-lived capabilities issued by the daemon.

## Architecture

### 0. Version-Independent Upgrade Supervisor

A small supervisor, independent from the Clay application release, owns:

- The public listening socket and readiness handoff.
- The single persistent-state write lease.
- Source and target binary selection.
- The active immutable sandbox-generation pointer.
- Maintenance mode, cutover, and automatic binary rollback.

Only one daemon generation can hold the write lease. The supervisor does not expose the target daemon to user traffic until target readiness and post-cutover probes pass. Systemd socket activation may provide the supervisor primitive on supported hosts; other deployment modes need an equivalent version-independent launcher.

### 1. SandboxManager as the Single Spawn Boundary

Introduce a server-side `SandboxManager` that owns every tenant-controlled process lifecycle. The following paths must not call `spawn`, `execFile`, or `pty.spawn` directly:

- Claude and Codex workers.
- Terminals and one-shot shell commands.
- Git, clone, worktree, and project creation operations.
- Skill installers and package helpers.
- MCP subprocesses.
- File, image, memory, debate, Mate, and scheduled-job helpers.

The manager accepts an explicit sandbox context:

```text
tenantId
linuxUser
projectId
projectPath
sessionId
runtimeClass
networkPolicy
resourcePolicy
```

It returns a managed process handle tied to a tenant cgroup and lifecycle record. CI must reject newly introduced tenant-facing direct spawn calls outside approved infrastructure modules.

### 2. Filesystem and Process Isolation

Use Bubblewrap or an equivalently reviewed Linux sandbox runtime to create:

- User, mount, PID, IPC, UTS, and network namespaces.
- A private `/tmp`, `/run`, and `/proc`.
- A minimal, restricted `/dev`.
- A read-only system runtime.
- Read-write mounts for the current project and tenant home only.
- Explicit read-only mounts for required Clay runtime assets.
- No view of other tenant homes, projects, daemon state, or host sockets.

Each process runs with the mapped tenant UID/GID, cleared supplementary groups, `no_new_privs`, no effective/permitted/inheritable/ambient/bounding capabilities, restricted setuid behavior, and a reviewed seccomp profile.

Project paths must be resolved and validated after symlink traversal. Mount points, home-root projects, nested projects, worktrees, and idmapped/shared mounts require explicit policy rather than implicit acceptance.

### 3. Authenticated Control Plane and IPC

Host locality is not authentication. Tenant processes must not gain control-plane access merely because they can reach localhost.

- Remove unauthenticated localhost bypasses from tenant-reachable MCP and control routes.
- Replace shared mode-`0777` worker sockets with tenant-private runtime directories and authenticated sockets.
- Issue short-lived capability tokens bound to tenant, project, session, operation, and expiry.
- Verify Clay RBAC and ownership on every request, even in OS-user mode.
- Prevent token reuse for another slug, session, or tenant.
- Never pass daemon-wide credentials through tenant environment variables, arguments, or readable files.

### 4. Network Isolation and Egress Broker

Each sandbox receives its own network namespace. Default egress is denied.

Block by default:

- Host loopback and Unix sockets.
- Peer tenant ports.
- RFC1918 and other private/link-local networks.
- Cloud metadata addresses such as `169.254.169.254`.
- Unapproved DNS and arbitrary inbound listeners.

Allow through a policy-aware broker:

- Selected model-provider APIs.
- Explicitly approved git and package endpoints.
- Authenticated Clay bridges.
- Administrator-defined destinations.

DNS resolution and proxy policy must use the same tenant identity and produce auditable decisions.

### 5. Resource Isolation and Lifecycle

Create a cgroup v2 scope per tenant or session with configurable limits:

- `memory.max` and `memory.swap.max`.
- `pids.max`.
- `cpu.max`.
- I/O and disk limits where supported.
- File-descriptor and execution-time limits.

Session stop, user deletion, daemon shutdown, and migration rollback must terminate the complete cgroup, not only the direct child PID. Persistent linger services must not outlive tenant authorization unless explicitly managed by policy.

## Migration Design

### One New Runtime, One Execution Path

The released strong-sandbox daemon does not contain a compatibility backend. Migration is part of the upgrade transaction and runs before the new daemon becomes active.

```text
old daemon serving
    -> discovering
    -> preparing
    -> shadow validating
    -> quiescing old daemon
    -> applying journaled changes
    -> starting strong-only daemon
    -> post-cutover validating
    -> upgrade committed
```

Any failure before cutover leaves the old daemon serving. Any failure after cutover stops the new daemon, restores journaled state, and restarts the retained old binary. The two daemons never serve tenant workloads concurrently.

Migration metadata is stored server-side and includes schema version, source and target versions, phase, checkpoints, complete user/project/session inventory, revision numbers, recovery journal, validation evidence, last error, and timestamps. A desired-state fingerprint alone is insufficient because it does not verify actual filesystem or runtime state.

### Upgrade Coordinator

The CLI/updater owns the transaction rather than the new daemon:

- Keep the current binary, configuration, and launch metadata until the upgrade is committed.
- Acquire an exclusive migration lease from the version-independent supervisor.
- Run the target release's migration helper alongside the old daemon in preparation-only mode.
- Ask the old daemon for an internally consistent export of users, projects, sessions, active work, and effective access decisions.
- Prevent the helper from serving user traffic or executing tenant workloads.
- Activate the target binary only after preparation and shadow validation pass.
- Automatically restart the retained source release if target startup or post-cutover validation fails.

Supported deployment images must bundle the sandbox runtime or install it as part of image/package preparation. A missing kernel feature or host dependency blocks activation before the old daemon is stopped.

### Phase A: Read-Only Discovery

Inventory and validate:

- Clay users, roles, Linux mappings, UID/GID, home, account status, and account provenance.
- Project visibility, owner, allowed users, worktrees, resolved paths, and the old daemon's effective access decisions.
- Session ownership, including ownerless legacy sessions and active background jobs.
- Actual file ownership, mode, ACL, mount, filesystem, device, and symlink state.
- Canonical project identity using resolved path plus filesystem device and inode.
- Running tenant processes, descendants, user services, and linger state.
- CLI credential and runtime locations required by each vendor.
- Required model, git, package, MCP, and integration network destinations.
- Host namespace, cgroup v2, seccomp, sandbox runtime, `setpriv`, and ACL capabilities.

Discovery writes a durable manifest and recovery journal before any mutation. It materializes implicit visibility and sharing semantics exactly as the source release currently evaluates them.

### Phase B: Deterministic Transformation Plan

Because Clay already owns the user, project, and session model, the helper derives the target state automatically:

- Preserve every valid Clay-managed user to Linux username to UID/GID mapping.
- Convert externally managed or shared mappings to dedicated Clay service accounts, with an audited copy of required home credentials and explicit rollback metadata.
- Preserve existing Linux homes and vendor credentials.
- Recreate a missing Clay-managed account with the same identity only when provenance, UID/GID availability, and home ownership can be verified.
- Resolve ownerless sessions to the project owner, or to the sole administrator for legacy ownerless projects, and journal the assignment.
- Convert implicit project visibility and sharing into explicit configuration fields.
- Generate a mount policy from resolved project, worktree, home, credential, and runtime paths.
- Generate authenticated IPC, capability-token, network, and cgroup policy.
- Relocate unsupported home-root or unsafe project layouts to managed storage when a semantics-preserving transformation is possible.
- Reconcile ACLs only where shared writes still require them, using restorable per-project checkpoints and actual access probes.
- Disable or remove lingering tenant services that would remain outside the sandbox after cutover.
- Produce an immutable sandbox generation and activate it later through one atomic generation-pointer rename.

If an ambiguous identity collision, unsupported filesystem, or non-Clay-managed account prevents a safe automatic decision, the upgrade remains on the old release and reports the exact blocker. It does not install a partially functional new runtime.

### Phase C: Shadow Validation While the Old Daemon Serves

Create non-serving sandbox canaries from the target policy and run them as the real mapped tenants:

- Read and write dedicated probe files in owned and explicitly shared projects.
- Fail to list, read, or write another tenant's private project and home.
- Verify existing vendor credentials can authenticate without copying another user's secrets.
- Fail to inspect or signal host and peer processes.
- Fail to connect to host loopback, peer ports, private networks, and cloud metadata.
- Fail to reuse a capability token for another tenant, slug, session, or operation.
- Verify private `/proc`, `/tmp`, `/run`, IPC, and namespace inodes.
- Verify zero capabilities and `NoNewPrivs: 1`.
- Verify cgroup limits with bounded CPU, memory, and process stress tests.

The helper validates every tenant and representative policy shape without routing production work through the target backend. Probe files are isolated, tracked in the journal, and removed after validation.

### Phase D: Global Atomic Cutover

After all shadow validation succeeds:

1. Put the old daemon into maintenance mode and reject new turns, terminals, schedules, and worker creation.
2. Wait for a short bounded grace period, persist active session state, and release the source daemon's write lease.
3. Recompute configuration revisions, account mappings, and every prepared path's device/inode identity. If anything drifted, leave maintenance mode and rebuild the staged generation.
4. Terminate every tenant process tree and user service, then verify that no legacy tenant process remains.
5. Apply journaled configuration, ownership, ACL, path, account, and runtime changes.
6. Atomically switch the active release and sandbox-generation pointers.
7. Start the strong-only daemon behind the supervisor without transferring user traffic.
8. Run post-cutover health, credential, positive-access, negative-access, IPC, network, namespace, and cgroup probes.
9. Transfer the listener and reopen traffic only after every required probe succeeds.

The maintenance window is short because expensive discovery, copying, policy construction, and canary work occur beforehand. An existing process is never adopted into the sandbox; it is checkpointed, terminated, and resumed through the single strong path.

### Phase E: Binary Rollback

If target startup or post-cutover validation fails:

1. Keep user traffic closed.
2. Stop the target daemon and kill every target cgroup.
3. Revoke migration-issued tokens and remove target runtime sockets.
4. Restore configuration, mappings, ACLs, ownership, modes, and active paths from the recovery journal.
5. Preserve and deliberately reconcile files created during validation or cutover rather than overwriting them.
6. Atomically restore the source release pointer.
7. Start the retained old daemon and verify its original positive and negative access behavior.
8. Reopen traffic only after rollback validation succeeds.

Rollback retains all project data, session history, homes, and credentials. The previous supported release must ignore unknown migration fields safely and expose the recorded failure to administrators.

Once the target daemon has accepted user writes, binary rollback additionally requires either an old-compatible persistent format or a replayable write journal. Without one of those guarantees, automatic rollback is limited to the pre-listener readiness window.

### Phase F: Commit and Cleanup

After a defined soak period with the strong daemon:

- Commit the migration version and archive the signed manifest.
- Remove source-release rollback artifacts only after explicit release criteria pass.
- Remove obsolete compatibility-only sockets, helpers, and temporary snapshots.
- Keep data-format downgrade guards even after the old binary is removed.
- Continue periodic drift and adversarial validation through the single strong path.

### Legacy Edge Cases

| Condition | Required automatic migration behavior |
|---|---|
| Missing sandbox dependency or kernel feature | Leave the old daemon serving and block target activation before maintenance mode |
| Existing `inheritGroups: true` | Discover required groups, replace them with explicit sandbox capabilities or device policy, then clear supplementary groups at cutover |
| Missing `linuxUser` record | Recover from stored user/home/project provenance or create a dedicated account before cutover; never run as root |
| Saved mapping points to a missing Linux account | Recreate the same verified Clay-managed identity and attach the existing home; never silently allocate a similarly named replacement |
| Ownerless session | Assign the project owner or sole legacy administrator in the journal; keep history and session ID unchanged |
| Project without explicit visibility | Materialize the source daemon's effective access decision before changing defaults |
| Home-root project | Relocate to managed project storage or generate a verified narrow mount policy before cutover |
| ACL or ownership drift | Snapshot actual state, reconcile from a per-project checkpoint, and prove allow/deny behavior with the mapped UIDs |
| Running or lingering process | Quiesce, checkpoint, kill the complete UID/cgroup process tree, verify zero survivors, then cut over |
| Username or UID collision | Resolve from Clay provenance; if ambiguous, leave the old daemon active and block activation rather than guessing |
| Credential incompatibility | Keep the original home and validate the target sandbox against the existing tenant credentials before cutover |
| Downgrade after target activation | Stop the target, reverse journaled mutations, restore the retained source binary, and preserve all user data |

## Delivery Roadmap

### Delivery Rule

Ship the existing OS-user runtime improvements first. Each of these releases must retain the observable behavior of every existing access decision and authorized action: session execution, terminals, CLI credentials, MCP tools, git/package operations, project sharing, and scheduled work. A foundation release must not widen a source denial. Do not make startup perform a global ACL repair, account conversion, path relocation, group-policy change, or other fleet-wide mutation.

An action may be denied by the strong runtime only when it was never authorized by the source runtime or when the administrator has explicitly changed its policy. If the target cannot reproduce a source-authorized action safely, the upgrade is blocked and the old daemon continues serving. It is never “fixed” by silently dropping a group, credential, socket, path, or network dependency.

Only after the contracts, policy data, and enforcement primitives are proven against a source-action compatibility matrix should the upgrade coordinator perform the one-time transformation required for the strong-only runtime. This keeps migration code narrow: it applies already-defined policy rather than inventing policy while mutating a live installation.

Every release in this roadmap must support a direct upgrade from every supported historical Clay release; upgrades must not require users to install intermediary roadmap releases. Compatibility is evaluated from the actual source release and source state, not inferred from the target version or the presence of an earlier marker. For a supported source, the transaction has only two valid outcomes: it commits with every source-authorized action preserved, or it leaves the source binary and state serving unchanged.

### First Objective: Atomic Compatibility Foundation

The first objective ends before any strong sandbox is activated or any existing tenant behavior is tightened. It is a sequence of small, independently releasable feature improvements that make a future migration *possible* while being behavior-preserving on their own.

Each change in this objective must be atomic in the operational sense:

- It is additive or a semantics-preserving internal refactor; it does not require a data migration to become safe.
- It reads every supported legacy configuration and persistent-state shape directly. New optional fields have source-compatible defaults and are never used to reinterpret existing access at read time.
- It does not change an existing account mapping, UID/GID, home, credential, group behavior, project visibility, sharing decision, session ownership, process command/environment, network reachability, or socket contract.
- It has an immediate rollback path to the previous binary without rewriting or discarding persistent state.
- It captures compatibility evidence or exposes diagnostics, but never makes an old action fail merely because the evidence is incomplete.

The output is a stable compatibility contract, not a partially enabled sandbox: a source-state exporter, release-identified policy readers, source-action fixtures, a behavior-preserving spawn facade, and side-effect-safe shadow contracts for replacement control-plane paths. These artifacts must be usable by the final coordinator when upgrading directly from any supported historical release.

The numbered tracks below decompose the complete program. This first objective comprises Track 0 and only the behavior-preserving portions of Tracks 1 through 3. It ends before Track 4 strong primitives, production enforcement, maintenance mode, or migration cutover.

**First-objective exit gate:** an isolated fixture matrix for every supported source release and state shape can upgrade directly to the latest compatibility-foundation release, preserve its recorded allow and deny decisions, execute source-authorized actions unchanged, accept representative source-compatible writes, roll back to its exact source binary, and preserve the meaning of all state in both directions.

### Compatibility Support Catalog and Evidence Model

Before implementing a compatibility reader, freeze the contract that it must reproduce:

- Enumerate every supported source release by immutable tag and commit, including its Node/runtime requirements, dependency lockfile, deployment shape, and known persistent-state layouts. “Supported historical release” is not an open-ended phrase; the catalog is versioned release policy.
- Supply source release identity explicitly from retained binary/package metadata. Never select access semantics from state shape alone because multiple releases may share a shape while interpreting missing fields differently. Unknown or unverifiable source identity is a diagnostic blocker for future cutover, not a serving-path denial in the foundation release.
- Record both source-authorized and source-denied decisions for every action family. Compatibility must neither break a valid action nor widen legacy access.
- Define normalized comparison rules for nondeterministic evidence such as timestamps, PIDs, ports, generated tokens, output ordering, transient external errors, and signal timing.
- Run every source, target, and rollback case from an independent copy-on-write clone of config, users, projects, sessions, homes, credentials, ACLs, and relevant runtime state. A historical daemon may migrate files merely by starting, so binaries must never share one mutable fixture.
- Use deterministic local substitutes for provider, git, package, and MCP dependencies in fixture tests. Real credentials and live endpoints belong to later non-serving canaries, not the compatibility baseline.
- Store foundation-only evidence in a versioned sidecar location that supported source releases ignore safely. Do not add compatibility markers to legacy-owned files unless every supported source binary is proven to retain them through its own read/write cycle.

### First-Objective Implementation Slices

Build the foundation in this order. Each slice is releasable by itself, requires no intermediary release to be installed, and must preserve every supported source binary's ability to interpret state written during the slice.

0. **Supported-source catalog and hermetic runner.** Pin the exact supported release set, source identities, runtime/dependency images, persistent-state layouts, external-service substitutes, and normalized evidence rules. Build copy-on-write source/target/rollback environments before implementing target readers.
1. **Source-behavior fixture matrix.** Run each pinned source binary and capture both allow and deny contracts for login, project/session access, terminal/agent launch, credentials, git/package operations, MCP/IPC calls, schedules, and shared-project behavior. Include restart and representative write sequences. These source results, not the target implementation, are the compatibility oracle.
2. **Current-branch stabilization.** Remove or isolate the behavior-changing hardening already present in the worktree. Retain only changes proven source-compatible, including collision-safe allocation for newly created accounts, before using the branch as a target baseline.
3. **Source compatibility inventory (read-only).** Add a reader registry keyed by explicit source release identity and persistent-state shape for historical config, user, project, session, and OS-user mapping formats. It returns a canonical in-memory snapshot and records the supplied source identity and recognized shape. It performs no provisioning, ACL operation, config write, credential read, or action denial.
4. **Non-blocking compatibility diagnostics.** Surface missing accounts, path ambiguity, group dependencies, credential locations, legacy sockets, and host prerequisites as diagnostics attached to the canonical snapshot. Diagnostics have no serving-path consequence, do not expose secret contents, and do not create a completion marker.
5. **Behavior-preserving policy readers.** Extract effective visibility, sharing, ownership, session resolution, and relevant deny decisions into pure functions keyed by source release identity. Differential tests must match the pinned source oracle. New writes may use explicit fields only when rollback tests prove that every supported source preserves their meaning; otherwise use an old-safe sidecar.
6. **Behavior-preserving process facade.** Route one spawn family at a time through an observational `SandboxManager` facade. The facade delegates to the current implementation and is accepted only when normalized command, environment, cwd, streams, signals, exit state, and resulting source action match. Do not change uid/gid, group, capability, network, mount, or cgroup behavior.
7. **Side-effect-safe replacement-path shadowing.** Add authenticated IPC/control-plane and sandbox-policy paths in shadow mode. Compare pure authorization decisions and normalized request/response envelopes while the existing serving route remains authoritative. Never duplicate a spawn, schedule, file write, git mutation, MCP mutation, or other side effect; exercise those paths only through explicit dry-run contracts or isolated synthetic canaries.
8. **Write-inclusive direct-upgrade and rollback harness.** For every historical fixture, test source binary -> latest foundation directly, allow/deny and action parity, representative target-period writes and restarts, latest foundation -> exact source rollback, and semantic state preservation in both directions. This harness is the release gate for every later track.

### First-Objective Exclusions

The following are explicitly deferred and must not be smuggled into foundation work: changing default supplementary groups, requiring `setpriv` for an existing workload, rejecting an existing missing mapping, global ACL repair, recursive ACL changes, visibility/default reinterpretation, account remapping, session-owner reassignment, namespace/mount/network/seccomp/cgroup enforcement, maintenance mode, or target-binary cutover.

### Track 0: Stabilize the Current Hardening Branch

**Outcome:** a safe, independently releasable OS-user observability and correctness update with no behavior change for valid existing actions.

- Keep unique Linux account allocation for newly created users; do not alter any existing Linux mapping, UID/GID, home, credentials, or group behavior. Make allocation race-safe by retrying a newly collided candidate rather than failing or reusing it.
- Inventory mapped-user resolution, `setpriv` availability, supplementary groups, credential locations, and project access outcomes without changing the current spawn semantics.
- Preserve an existing mapping even if its Linux account is missing. Report it as an upgrade blocker; do not allocate a replacement account for that user automatically.
- Remove startup-wide `provisionAllUsers()` and recursive ACL reconciliation from the daemon path. A desired-state fingerprint is not evidence that the filesystem still enforces the intended policy.
- Retain the source runtime's incremental ACL behavior for the specific project/user mutation that triggered it, while adding non-blocking actual allow/deny probes and diagnostics.
- Add focused source-behavior tests for account collisions, missing mappings, supplementary groups, credentials, and project-access grant/revoke behavior. These tests become the compatibility baseline for later tracks.

**Exit gate:** no existing OS-user allow or deny decision changes because the daemon restarts or this track is deployed; the release only exposes compatibility diagnostics and evidence.

#### Track 0 Execution Plan

Implement Track 0 as one reviewable stabilization change with the following internal sequence:

1. **Freeze the source behavior baseline.** Add focused tests that encode the current `main` behavior for omitted `inheritGroups`, unavailable `setpriv`, ownerless sessions, users without a Linux mapping, existing mappings whose Linux account is missing, legacy project visibility, incremental ACL grants/revocations, and non-fatal startup provisioning failures. Include positive and negative cases so stabilization cannot widen access accidentally.
2. **Remove premature enforcement.** Restore source-compatible supplementary-group defaults and fallback behavior; remove serving-path `503` checks for missing mappings; restore non-fatal mapped-user resolution; and remove blocking startup provisioning, global ACL reconciliation, migration fingerprints, and startup exits. Do not change existing user, project, session, ACL, credential, or config state.
3. **Retain only safe new-account allocation.** A newly created Clay user must never reuse an unrelated pre-existing Linux account. Allocate a suffixed name and retry when another creator wins the `useradd` race. Do not rename or repair any saved mapping, and preserve the source response behavior if new-account provisioning fails.
4. **Add read-only diagnostics.** Introduce a dedicated server module under 500 lines that reports mapped-account resolution, `setpriv` availability, supplementary-group dependencies, credential path presence without reading secret contents, and project access probe outcomes. Diagnostics must be best-effort, non-blocking, admin-scoped when exposed, and stored only in memory or logs during Track 0.
5. **Preserve narrow ACL operations.** Keep ACL changes attached only to the user/project mutation that requested them. Record the operation result and, where the host supports it, run non-mutating mapped-identity allow/deny probes. A probe failure or unavailable probe dependency produces a diagnostic; it never retries recursively, rewrites unrelated ACLs, blocks startup, or changes the serving decision.
6. **Verify source parity.** Run the focused OS-user suite plus affected authentication, project access, session, daemon startup, and settings tests. Inspect the final diff to ensure no default, denial, persistent marker, global reconciliation, or strong-sandbox enforcement remains.

Track 0 is complete only when all of these statements are true:

- Restarting the daemon performs no new fleet-wide account or ACL mutation.
- An omitted `inheritGroups` value and a missing `setpriv` binary behave exactly as on the pinned source release.
- An existing missing or invalid Linux mapping is diagnosable but does not introduce a new HTTP, WebSocket, session, or startup denial.
- New account creation cannot claim an unrelated existing Linux username, including under a simulated allocation race.
- Legacy visibility, ownership, session, credential, and incremental ACL behavior match the source baseline.
- Every new diagnostic is non-mutating, non-secret-bearing, and incapable of changing a serving-path result.

**Implementation status (2026-08-27):** implemented and verified against the full test suite. The implementation preserves source serving behavior, adds race-safe allocation only for new Linux accounts, and runs read-only diagnostics in a bounded child process after existing startup provisioning completes.

### Track 1: Make Access Semantics Explicit in the Existing Runtime

**Outcome:** one deterministic, versioned access-policy model used by RBAC, ACL operations, and future migration discovery.

- Extract effective project visibility, ownership, sharing, and session-owner resolution into pure policy functions.
- Materialize newly edited project visibility and sharing fields explicitly; preserve legacy effective behavior for records that have not yet migrated.
- Ensure every new session has an owner. Preserve existing ownerless-session behavior during foundation releases and report it diagnostically; assign and enforce an owner only in the journaled migration cutover.
- Apply ACL changes through the source runtime's narrow project/user operations and verify the mapped UID's positive and negative access after each operation without changing an existing effective access decision.
- Record auditable access-operation results, not a global “migration complete” fingerprint.

**Exit gate:** the same policy function answers “may this user access this project?” for HTTP/WS RBAC, ACL updates, and offline discovery tests.

### Track 2: Close Existing Control-Plane Escapes

**Outcome:** OS-user processes cannot obtain tenant or daemon authority through local reachability.

- Add authenticated, tenant-bound MCP bridge and control-route paths alongside the source path, and prove each existing client action against them before replacing the source route at cutover.
- Add tenant-private worker directories and authenticated endpoints alongside existing sockets; do not remove a live client dependency until its replacement has passed compatibility tests.
- Re-check RBAC and tenant/project/session ownership for every IPC and bridge operation.
- Build replacement paths that use tenant-scoped credentials instead of daemon-wide credentials in tenant environments, arguments, or readable runtime files. Keep the source serving path unchanged until replacement parity is proven and the global cutover activates it.
- Add two-tenant negative tests for token replay, cross-project IPC, and localhost/control-plane access.

**Exit gate:** every source-authorized bridge operation succeeds through its tenant-bound replacement, while cross-tenant operations fail in the replacement path.

### Track 3: Establish the Future Spawn and Policy Contracts

**Outcome:** all tenant process creation has an inventory and a stable interface, without changing its runtime backend yet.

- Define `SandboxManager` context, lifecycle record, process-tree termination contract, and policy schema.
- Inventory every tenant-controlled `spawn`, `execFile`, and PTY path; route them through a behavior-preserving manager facade whose command, environment, working directory, streams, signals, and exit behavior match the source path.
- Add CI detection for newly introduced tenant-facing direct process spawns outside approved infrastructure.
- Define canonical project/worktree path validation and explicit handling for home-root, nested, symlinked, and shared paths.
- Collect non-sensitive lifecycle telemetry needed by the future cgroup and migration work.

**Exit gate:** every execution entry point is known, test-covered, and replaceable through one API with source-equivalent action results; no sandbox namespace is activated in this track.

### Track 4: Build and Validate Strong Primitives Off the Serving Path

**Outcome:** sandbox, network, credential, and cgroup policies are tested as canaries, never as a partial production backend.

- Build immutable sandbox-generation manifests from the Track 1 policy model.
- Implement namespace/mount, capability drop, `no_new_privs`, seccomp, private runtime filesystem, network-egress, capability-token, and cgroup policies.
- Run non-serving canaries for every source-authorized action against dedicated probe files and test credentials using mapped tenant identities.
- Verify positive authorized access plus negative filesystem, process, IPC, network, metadata, capability, and resource-limit cases.
- Publish host prerequisite and distribution support checks; a failed check is diagnostic only while this track is shipped.

**Exit gate:** every supported source-action shape succeeds in its target policy and adversarial negative canaries pass on every supported host image, with complete evidence retained outside tenant-visible storage.

### Track 5: Pinpoint Migration Prerequisites and Transaction Framework

**Outcome:** upgrade mechanics are ready before any migration mutates a customer installation.

- Introduce the version-independent supervisor, listener handoff, persistent-state write lease, retained source binary, and active-generation pointer.
- Implement read-only discovery that exports the old daemon's effective users, mappings, projects, sessions, access decisions, active work, paths, credentials locations, and runtime prerequisites.
- Make discovery source-version aware: select readers from explicit retained-binary/package identity, then validate the persistent-state/configuration shape. Cover every supported historical combination, including releases that predate the compatibility-foundation sidecar.
- Create durable manifests, recovery journals, checkpoints, revision checks, and source-release-readable metadata.
- Add an administrator readiness/status surface that reports exact blockers without stopping the current daemon.
- Exercise source/target startup, pre-listener readiness, reboot resume, and rollback mechanics using fixtures only.

**Exit gate:** discovery is idempotent and non-mutating; direct-upgrade fixtures from every supported source release produce the same canonical manifest and source-action inventory; any host prerequisite blocker leaves the old daemon serving.

### Track 6: One-Time Transformation, Shadow Validation, and Atomic Cutover

**Outcome:** the only migration release; it transforms proven data contracts and activates the one strong execution path globally.

- Derive a deterministic transformation plan from the Track 5 manifest: explicit visibility, session ownership, mount policy, IPC/capability policy, network policy, cgroup policy, and only necessary ACL/account/path changes. Each transformed policy must include the source actions it is required to preserve.
- Perform expensive copies, account preparation, and policy construction while the old daemon continues serving.
- Run per-tenant non-serving shadow canaries and require every recorded source-authorized action plus both allow and deny isolation probes to pass before maintenance mode.
- During the short maintenance window, revalidate revisions and inode identities, quiesce and terminate legacy process trees, apply the journal, atomically switch binary and generation pointers, then start the strong-only daemon with traffic still closed.
- Reopen traffic only after post-cutover health and adversarial probes pass. On any target failure, stop target cgroups, reconcile journaled state, restore the retained binary, and validate the old runtime before reopening traffic.

**Exit gate:** no tenant workload is ever served through mixed old/new backends; every recorded source-authorized action continues to succeed; and every post-cutover sandbox setup failure is fail-closed.

### Track 7: Release Qualification and Cleanup

**Outcome:** strong-only enforcement becomes supportable rather than merely implemented.

- Run the upgrade, restart, fault-injection, rollback, downgrade, and two-tenant escape matrix across supported Linux distributions and deployment images.
- Define soak-period thresholds for denied-control-plane events, sandbox setup failures, cgroup termination time, and migration recovery.
- Archive signed migration evidence and retain downgrade guards.
- Remove source-release artifacts only after explicit release criteria pass; keep periodic drift and adversarial validation through the single strong path.

**Exit gate:** the strong-only runtime is released only after the supported-host matrix and migration/rollback matrix are green.

### Suggested Change Boundaries

| Change set | Depends on | Must not include |
|---|---|---|
| Supported-source catalog and hermetic runner | None | Target-derived compatibility assumptions or shared mutable fixtures |
| Current hardening branch | Source behavior baseline | Startup-wide ACL repair, account remapping, or automatic data migration |
| Explicit access policy | Current hardening | Namespace, cgroup, or upgrade-supervisor work |
| Control-plane hardening | Explicit access policy | Filesystem/account transformation |
| Spawn facade and inventory | Current hardening | A second production sandbox backend |
| Strong canaries | Spawn facade + control-plane hardening | Serving tenant traffic through the new backend |
| Supervisor and discovery | Strong canaries | Cutover mutations or maintenance mode |
| Migration and cutover | All prior tracks | Compatibility execution in the target daemon |

## Acceptance Criteria

- Tenant namespace inodes differ for mount, PID, IPC, UTS, user, and network namespaces.
- Tenants cannot read, write, list, signal, attach to, or observe peer or host resources outside policy.
- `/proc/self/status` reports `NoNewPrivs: 1` and zero effective, permitted, inheritable, ambient, and bounding capabilities.
- Tenant requests to host loopback, peer ports, private ranges, and cloud metadata fail unless explicitly approved.
- No daemon-wide credential appears in tenant environment, arguments, filesystem, sockets, or `/proc`.
- Sandbox tokens expire, are operation-scoped, and fail for another tenant, project, or session.
- Fork-bomb and OOM tests remain inside the tenant cgroup and do not degrade another tenant or the daemon.
- User deletion and session termination remove every process in the tenant cgroup within a defined target, initially five seconds.
- Migration discovery accounts for 100% of users, projects, and sessions before cutover.
- The release policy enumerates every supported source by immutable identity, runtime/dependency environment, and persistent-state shape.
- Every supported historical source release and persistent-state shape can upgrade directly to the target transaction; no roadmap intermediary release is required.
- Foundation differential tests preserve recorded source allow and deny decisions and normalized action outcomes.
- After representative writes and restarts on the foundation release, the exact source binary can resume with semantically equivalent config, users, projects, sessions, homes, credentials, and access behavior.
- Fault injection before cutover leaves the source daemon serving; fault injection after cutover produces a verified binary rollback.
- Existing public/private projects and owned/shared sessions preserve approved semantics in upgrade and rollback tests.
- Every source-authorized action recorded during discovery succeeds in its shadow sandbox and after cutover, unless an administrator explicitly changed the action's policy.
- The target daemon never serves tenant traffic until the migration transaction and post-cutover probes succeed.
- The installation never serves tenant workloads through source and target execution paths concurrently.
- No sandbox setup failure can execute a tenant workload with daemon UID, daemon environment, or a weaker backend.

## Observability and Operations

Expose to administrators:

- Upgrade transaction phase and source/target release identity.
- Dependency and kernel-feature readiness.
- Projects and sessions blocking enforcement.
- Source legacy process count during quiesce and target sandbox process count after cutover.
- Egress decisions and denied control-plane requests.
- Cgroup utilization and limit events.
- Last validation evidence and last migration error.
- Maintenance window state, cutover checkpoint, and binary rollback availability.

Security-sensitive logs must identify tenant, project, session, policy decision, and sandbox instance without recording credentials.

## Current Branch Disposition

The initial OS-user hardening branch is the beginning of Track 0, not the migration implementation. Keep unique allocation only for new accounts; do not change existing mapping or spawn behavior in this release. Make these changes before it is released:

- Remove the blocking startup-wide recursive ACL reconciliation and its completion fingerprint. Do not replace it with an upgrade helper in this release; the helper belongs to Track 6.
- Keep ACL work limited to the project/user change that invoked it; add a real mapped-UID allow/deny probe as diagnostics without changing source access behavior.
- Treat a saved mapping whose Linux account is missing as an upgrade blocker and recoverable state; do not provision a new account for that existing Clay user or reject its current source action in this release.
- Treat pre-existing supplementary-group requirements as a future explicit sandbox-policy input. Do not change inherited-group defaults until the target policy proves the same source actions work.
- Reserve capability removal and `no_new_privs` for the strong sandbox backend in Track 4, where they can be verified together with namespace and seccomp policy.

## Open Questions

1. Use Bubblewrap directly, systemd transient units, or a layered combination for the strong backend?
2. Apply cgroups per session, per tenant, or per tenant with nested session scopes?
3. Which provider and package endpoints belong in the default egress policy?
4. How should shared writable projects handle UID ownership: ACLs, shared groups, or idmapped mounts?
5. What maximum maintenance window is acceptable for checkpointing and restarting long-running agent and Ralph sessions?
6. Which Linux distributions and container hosts are officially supported for enforced mode?
