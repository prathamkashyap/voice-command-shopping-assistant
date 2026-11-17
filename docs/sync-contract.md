# Shopping list persistence and synchronization

The current list is stored in `localStorage`, separate from its offline queue. Firestore item documents live at `users/{uid}/shoppingList/{itemId}`. The existing reader treats a missing local item as a potential remote addition and uses timestamps for whole-item replacement. A device clock and an upload timestamp cannot establish what another client saw before editing.

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

The legacy queue repair can protect unacknowledged work while this design is implemented. It does not supply transactional storage, receipts, or account migration.
