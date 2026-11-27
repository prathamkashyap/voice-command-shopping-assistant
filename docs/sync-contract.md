# Shopping list persistence and synchronization

Authenticated lists, undo state, and pending operations are stored in IndexedDB. Device-only lists remain in `localStorage`. Firestore item documents live at `users/{uid}/shoppingList/{itemId}`. The existing reader uses timestamps for whole-item replacement. A device clock and an upload timestamp cannot establish what another client saw before editing. The decisions below include the intended revision protocol; the implementation status distinguishes what is available now.

## Decisions for the next sync version

- Store the local projection, undo metadata, and pending operations in one IndexedDB transaction. A local edit is saved when that transaction commits. Keep the list usable without authentication, in a distinct local namespace. A guest list joins a cloud identity only through a deliberate import or link. Each identity has its own queue and a single coordinator for app tabs.
- A queued change has a durable operation ID, stable item ID, observed server revision, and typed change. Track the fields it changes. A batch command gets a shared operation group. Keep quantity, unit, and product identity as explicit fields. Currency and package information need a versioned schema change if stored rather than derived from the catalog.
- Submit queued changes with Firestore transactions when online. Write the item revision and the receipt for the operation group together. A receipt makes retries safe when a commit succeeded but its response was lost. Read the latest revision before applying a patch. Leave Firestore persistent client buffering disabled so the app has one durable source of pending work.
- One item revision increments per committed change. Assign a server timestamp for display and diagnostics. When two clients change different fields, preserve both edits. When they set the same field from the same old revision, keep the first committed value and show a conflict for the later edit. A deletion wins over edits based on the old state. A restore is a new operation targeting the exact tombstone revision that the user is undoing.
- Persist tombstones even if the remote document did not yet exist. A stale snapshot cannot invalidate one. Keep tombstones and receipts until there is a tested procedure to prevent dormant clients from replaying against pruned history. Treat a pending local operation as an overlay over the acknowledged remote projection.
- Retry transient errors with bounded backoff in one sender. Stop and report authorization, conflict, and storage errors with a way to review or export pending changes. Report synced only after the confirmed remote view is available and the active queue is empty. A cache read, internet connection, or service-worker message cannot guarantee that.

## Compatibility and rollout

Treat the existing item paths, local keys, and queue shape as migration inputs. Preserve the original data before the first migration and keep unknown or malformed records available for recovery. Derive stable import IDs so a restart cannot import a legacy queue twice. A legacy queue has no proven owner. Keep it in a recoverable local namespace until the user explicitly associates it with an identity.

New readers initially accept old documents with a baseline revision. In emulator fixtures, verify the existing timestamp and deletion fields, trim client-only fields from writes, and validate the new revision, receipt, and tombstone types through Firestore rules. Rules and client rollout need a compatibility gate before revised writes are enabled. Retire old writers before accepting revision-dependent edits, since they overwrite full documents without checking versions. Rollback can disable cloud writes and keep/export the new local projection and queued changes. Reverting to the legacy writer would discard the new conflict guarantees.

## Acceptance cases

| Scenario | Expected result |
| --- | --- |
| Add, edit, delete, then restart offline | The local view and the pending operation order survive |
| Server commits, client loses the response | Receipt recognizes replay and the edit applies once |
| Two users of the same list edit distinct fields | Both fields survive |
| Two sessions set the same quantity from the same revision | First confirmed write remains and the other session can review its conflict |
| Offline delete races with a stale remote edit | The deleted item stays hidden |
| Undo is requested against a newer tombstone | The old undo requires review |
| User switches accounts with pending work | Previous queue is retained and never submitted as the new user |
| Browser storage write fails | No saved confirmation and the last durable projection remains recoverable |

## Implementation status

Authenticated list edits and undo state are committed with their queued mutations in one IndexedDB transaction scoped to the Firebase UID. The sender removes a group after Firestore acknowledges it. Web Locks serializes drain work across tabs where supported. Each tab serializes its own work in browsers without Web Locks.

Each group keeps its original UUID across retries and restarts. A Firestore transaction reads `users/{uid}/syncReceipts/{operationId}` before writing. If absent, it writes the changed items or tombstones and a receipt `{ version: 1, committedAt: serverTimestamp() }` together. If present, it leaves server data untouched and reads the group's affected items for local reconciliation. A failed transaction or lost response leaves the group queued. The callback checks its captured account, database, and session before and after reads on every attempt. It does not mutate application state.

A replay acknowledgment removes the group and reconciles its cached list in one IndexedDB transaction. Confirmed values replace that group's optimistic values, including values stamped by an incorrect device clock, and remaining queued edits are applied afterward. A newer confirmed listener value takes precedence over an older replay read. Undo state is preserved. If another sender already acknowledged the group, the durable projection is returned without applying the old reconciliation again. Storage failure rolls back both acknowledgment and projection changes.

Receipt rules allow only the owner to read or create the exact versioned receipt with a server commit time. Clients cannot update or delete receipts. Receipts have no automatic expiry; pruning them would let dormant clients replay an old operation. This provides duplicate protection for the same operation ID even without Web Locks. It does not resolve conflicts between distinct operation IDs, prevent older clients from overwriting item documents, or add revision-aware restores.

The sender schedules up to four retries per queued group for `unavailable`, `deadline-exceeded`, and `aborted` errors returned by Firestore after its own transaction attempts. Waits grow with jitter within 0.5–1, 1–2, 2–4, and 4–8 seconds. The sender releases its tab lock during each wait and checks the durable queue before sending again. Going offline cancels the timer, and reconnecting resumes within the same retry budget. Changing accounts cancels the prior session's retry. Authorization and other errors stop the sender at the failed group. Exhausted or stopped groups remain on this device with later edits queued behind them. Reloading starts a new sync session, and the list remains available to export. [Firestore error handling](https://docs.cloud.google.com/firestore/native/docs/use-rest-api#section-error-handling)

Startup reads the current account's cached list and queue together and subscribes to snapshots. Authenticated edits send only changed records. A queued edit stays visible, and a queued deletion stays hidden, when an older snapshot arrives. The IndexedDB upgrade rebuilds the account cache from its existing queue. Previously acknowledged cloud items join the cache when the listener next receives confirmed records.

Existing device-list data remains accessible through **Device list** or `/?mode=local`. The account and device lists use separate storage. The prior unowned queue remains in the browser's local storage under `voice_shopping_offline_queue` for recovery. Assisted import, item revisions, and conflict review remain subsequent steps.

## Receipt rollout and verification

Deploy the additive receipt rules before releasing the receipt-aware client. Existing item fields and IndexedDB operation IDs stay compatible. If the new rules are missing, cloud writes fail and the local outbox remains available for retry; do not fall back to the old writer. Old queued operations that previously committed without a receipt cannot be retrospectively deduplicated. Keep receipts when rolling back a client. This repository change does not deploy either rules or hosting.

The protocol follows [Firestore's transaction guarantees and restrictions](https://firebase.google.com/docs/firestore/manage-data/transactions). Transactions can rerun their callbacks and fail offline; IndexedDB remains the durable queue. Each group contains at most 400 item changes plus one receipt. This preserves a bounded write count but does not bypass Firestore request-size limits for unusually large item payloads.

Regression coverage is divided between `test/sync-receipts.test.js` (session retirement and projection behavior), `test/firebase-sync-integration.test.js` (real commits, lost responses, concurrent receipt reads, restored deletions, and owner/schema rules), and `e2e/sync-storage.spec.js` (real IndexedDB atomic acknowledgment and rollback). Run `npm run lint`, `npm test`, and `npm run test:local` before releasing this change. The last command uses only the local demo Firebase project.

Verified on 26 November 2026: lint passed; `npm test` reported 156 passes and 5 expected emulator skips; `SHOPPING_FUNCTIONS_PORT=5501 PLAYWRIGHT_BROWSERS_PATH=/tmp/vcsa-browsers npm run test:local` passed all 13 Firebase emulator checks and all 10 Chromium checks. The alternate Functions port avoids an existing local service on port 5001. This verifies the local implementation, not a production deployment or the future revision/conflict protocol.
