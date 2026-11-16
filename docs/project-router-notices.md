# Project Router creation notices

This feature observes the common committed `thread.created` stream and sends compact creation metadata to an explicitly registered Router in the same local project. It is disabled by default and adds no MCP tool. It does not enable any other feature.

## Configuration

The server reads `Path.join(ServerConfig.stateDir, "project-router-notices.json")` every delivery tick (five seconds) and before each notice. This is a server-local sidecar, not a project file or shared wire setting. An absent file, empty content or `{}` disables delivery. Malformed/unreadable content pauses delivery and records a fixed error code; it never clears the ledger. Unknown properties and duplicate project bindings are rejected.

Disabled template:

```json
{ "schema": 1, "enabled": false, "bindings": [] }
```

Binding shape:

```json
{
  "schema": 1,
  "enabled": false,
  "bindings": [
    { "projectId": "ACTUAL_LOCAL_PROJECT_ID", "routerThreadId": "ACTUAL_LOCAL_ROUTER_THREAD_ID" }
  ]
}
```

This documentation does not install or enable any binding. A project stays unbound until you add its own Router thread to the file. There is no title search, fallback or role-file discovery.

For an authorized installation, prepare the complete file beside its destination, then atomically rename it into place. Keep `enabled:false` during preparation. Change it to `true` when delivery should start. No restart is needed for subsequent sidecar updates once this implementation is loaded. Unknown schema or invalid identifiers hold delivery rather than normalizing guessed values.

## Activation, pause and restart

The runtime worker parks behind the existing server activation gate. Its first valid `enabled:true` tick atomically persists the global committed-event high-water. Threads at or before that boundary never become notices, including when bindings are added later. A creation racing this initialization is classified by its committed sequence.

After first enable, the durable cursor captures every later eligible creation, including while delivery is disabled or configuration is malformed. Restart catches up from that cursor. A missing Router binding remains owed; it does not silently discard creations. Native imports are excluded by their co-committed imported provider-thread record; legacy v1 history is excluded by `historyOrigin`, while a co-committed fork transfer preserves genuinely new forks that inherit that flag. Rename, move, run start and import rediscovery do not create another notice.

Disable/re-enable preserves the original global boundary, cursor and all owed notices. Re-enable resumes capture catchup and delivery, not a fresh historical scan. Pausing this feature does not cancel ordinary messages already accepted into a Router's queue.

## Privacy, identity and delivery

Each ledger row initially contains only event/sequence identity and allowlisted creation project ID, thread ID, shortened title (120 code points; controls removed), creator enum and creation time. Before constructing a message, the current target must exist, belong to the same project and be neither archived nor deleted. Presentation settlement does not revoke an explicit Router registration or its standing work; ordinary supported send handles run/queue and presentation lifecycle without manual wake/unsettle upkeep. Parent ancestry is omitted entirely. Prompts, human messages, attachments, history, model choices and raw event payloads are never copied. The title is labelled untrusted metadata.

The original destination, body and deterministic command/message IDs are durably pinned before normal `ThreadManagementService.sendToThread(mode:"auto")`. Auto delivery follows the existing host's steering/queue rules and does not interrupt a Router. The worker makes no provider call itself. Native acceptance does not prove the provider consumed the notice.

Changing/removing a binding holds a pinned pending notice instead of retargeting it. To resume, restore its original valid binding. Already accepted notices are not resent. Unknown send outcomes first reconcile the original command receipt and matching original message event. Reconciliation occurs before current target/binding checks, so a successful old send is recognized even if its destination later moves, archives or deletes. Accepted receipts without exact message proof hold; rejected receipts hold; neither creates a new retry identity.

For new sends, a host-only fiber-local guard validates the exact command/thread/project again in `EventSink.commitCommand`, after receipt replay and before events/effects, in the same existing SQL transaction. A project/archive/delete race rolls back the newly reserved receipt and all command mutations; presentation settlement alone remains eligible. No target lock is reacquired.

## Inspection and rollback

The read-only inspection surfaces are SQLite tables `project_router_notice_state` (first boundary, cursor, configuration error) and `project_router_notices` (original identity, pinned body/destination, acceptance and fixed retry/hold reason). No reset or retarget command is provided. Inspect only the owning server/project scope; the ledger contains short creation metadata and eventual notice bodies.

Rollback is setting `enabled:false` atomically while retaining the sidecar bindings and durable ledger. Do not delete/reset the cursor, erase pending rows, mint new keys or edit stored recipients. Binary rollback compatibility with the added migration follows your normal database procedure; disabling delivery is the immediate reversible feature rollback.

## Proposed validation (not executed by the author)

Compiler first on the exact integrated source; then whole `ProjectRouterNotices.test.ts` with one worker. Its 21 authored cases cover strict configuration, first enable, activation parking, committed-stream delivery/restart, a real fork, import exclusion, project isolation, missing/changed bindings, immutable retry identity, accepted/rejected/unverified receipt reconciliation, already-settled and settlement-at-commit normal-send acceptance, three project/archive/delete transaction race rollbacks and a 105-creation durable pagination fixture. The pagination fixture substitutes send only to examine backlog fairness; other delivery/race fixtures use real normal ThreadManagement, EventSink and SQLite with no effect worker/provider.

Also cover existing whole `Migrations.test.ts`, `FoundationPersistence.test.ts` and `Orchestrator.control-reads.test.ts`, with actual server compiler diagnostics retained. No checks have been run for this candidate by its author. No review, compile or focused fixture result alone establishes actual provider consumption or feature E2E completion.
