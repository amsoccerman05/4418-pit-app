# IMPULSE scouting · 2026 REBUILT

Scouting lives in **Competition Operations → Scouting** and uses the existing active team accounts and Pit events. It is an independent implementation inspired by Lovat’s workflow, not a source-code fork or an exact clone. No Lovat code, artwork, private data, or credentials are imported.

## Competition quick start

1. Open the app and sign in while connected. Choose **Scouting** and verify the event.
2. Choose **New match report**, enter the robot team and match, and confirm the alliance/station. The picker includes the existing 4418 TBA schedule and saved manual practices. To scout other matches, enter `qm17`, `sf1m2`, `f1m1`, `p1`, or a named `practice:warmup` key. All teams can be entered; this release does not download the entire event’s schedule.
3. Use the AUTO and TELEOP fuel counters, then record climb, estimated accuracy, observed capabilities, ratings and notes. Leave anything unseen as **Not observed**. Fuel is observed/estimated fuel entering the hub, not official scored points: inactive hubs do not score fuel.
4. Review the team and match, then choose **Submit report**. This first saves an immutable safety copy on the current device, then sends it immediately to the team database while connected. Wait for **Synced to the team database**. If offline, it automatically retries when you reconnect. **Sync reports** remains a manual retry option.
5. Use **Teams** and **Compare** for synced evidence. Leadership can assign scouting coverage and manage **Picklist** rank, availability and notes. Use **New pit report** for team-reported capabilities, kept separate from match metrics.

### Corrections and repeat submissions

Open **Teams → Reports & notes → Correct this report** to correct your own submission. Competition leadership can correct another scout’s report. A correction is a new report linked to its predecessor; the original remains in history. Only the latest report in a correction chain is included in summaries. Two simultaneous corrections cannot silently overwrite one another.

A scout can submit one original report for a particular event, robot and match (or one original pit report per event/robot). Another scout can independently report the same robot/match. A report retry retains its client-generated UUID: the server accepts an exact retry once, rejects reused IDs with different contents or another actor, and rejects duplicate original reports created with a new ID. After event completion, exact retries can still confirm existing submissions; new submissions require an active event.

## Offline, device storage, and recovery

- **Loaded-tab collection:** start online and keep the signed-in tab open. Draft edits and reviewed reports are durably saved in browser localStorage. Losing the network does not discard them. Scouting queues are independent of safety-critical battery/checklist/issue operations, which remain online-only.
- **No offline cold start:** this release does not cache the app shell or authenticated shared reports. Reopening the app, reloading its resources, or signing back in requires a connection. Once the same account/event is reopened online, its saved drafts and outbox return.
- **Cloud-first submission:** draft edits never upload until the user submits. Submitted reports upload immediately online and retry automatically on reconnect or reopening the same signed-in account/event. Failed attempts remain available for manual retry. “Synced” requires the exact report ID to be acknowledged. Network failures, interrupted tabs and uncertain saves keep the record for duplicate-safe retry.
- **Account boundaries:** records are partitioned by authenticated actor, event and demo/live mode. Signing out hides but does not erase local records. The next account cannot see or submit the previous account’s queue through the app. Database roles are rechecked on every request. No auth token, credential, or copied profile is stored in the scouting payload.
- **Device caveat:** localStorage is not encrypted. Browser/site-data clearing, device loss, private browsing limitations, or storage quota errors can prevent recovery. Do not place student personal details or unrelated sensitive information in robot notes. A storage failure is shown and never reported as a successful save.
- **Backup:** Device → Export device backup saves this account/event’s own drafts and outbox. Restore requires the same account, event and demo/live scope. Restored reports are queued for automatic idempotent confirmation when connected, even if another device had acknowledged them previously. This is IMPULSE’s format, not Lovat-compatible import or QR transfer.
- **Multiple tabs:** per-record storage and immutable receipts protect against unrelated records clobbering one another. Draft edits check their revision; a conflicting edit is rejected rather than silently lost. Concurrent synchronization uses leases, and a late failed attempt cannot replace a confirmed acknowledgment.

## Evidence and statistics

Summaries show synced observations only. Averages first average multiple scouts’ values within a robot/match, then weight observed matches equally. Missing values are excluded rather than converted to zero; an explicit observed zero counts. AUTO, TELEOP and combined-fuel sample sizes are separate. Combined fuel requires both AUTO and TELEOP counts in an observation. A team’s total match count is not necessarily its fuel sample size.

Endgame climb is the observed proportion of L1/L2/L3 success, excluding unknown endgames. Disabled/no-show is a report flag. Driver and defense use IMPULSE’s subjective 1–5 scale; these are not calibrated predictions or Lovat’s stored bucket codes. Small samples and differing observers matter. Pit capabilities are team-reported and never folded into observed performance averages.

CSV export contains current report observations and notes, without scout display names or user IDs. Cells are quoted and spreadsheet formula prefixes are neutralized. Exporting an existing report is not permission to upload or share it elsewhere.

## Access and database rollout

Apply `supabase/migrations/20261010013034_competition_scouting.sql` once to the existing Inventory/Pit Supabase project, after the existing Pit, competition and manual-practice migrations. The application does not run migrations.

The migration adds only scouting observations, assignments, picklist, management audit history, private idempotency receipts, validation helpers and three RPC entrypoints. It does not change Inventory data, Auth, existing profiles, role assignments or existing Pit RPC definitions. An additive guard prevents rebinding an event’s TBA key once scouting records or assignments exist.

- Active `readonly`, `student`, `lead`, `mentor`, and `admin` team profiles may read.
- Active `student`, `lead`, `mentor`, and `admin` profiles may submit their scouting reports.
- The existing `competition_manager()` rule governs assignments, picklist, and correcting someone else’s observation: mentors/admins and existing active leadership-position holders. Being a student/lead alone does not create competition-management rights.
- Anonymous, inactive, parent and guest roles are denied. New roles do not silently inherit access.
- All public scouting tables have RLS and SELECT-only authenticated grants. Direct client inserts, updates, deletes and history changes are denied. Public RPC wrappers are security-invoker; narrowly scoped private implementations enforce the trusted existing profile/leadership helpers with an empty search path. Receipt data is not exposed.
- Submitted observations and audit history are immutable. Assignments/picklist updates require the currently loaded version. An event cannot be switched under existing scouting identities.

No new credentials, OAuth grants, storage bucket, external data upload or background job is required. Team data refreshes on entry, connection recovery, explicit refresh and a 30-second read-only poll; this feature does not depend on new realtime publication grants.

## Verification

Run `npm run build`, `npm test`, and `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e` when using system Chromium. Unit tests cover schemas, unknown values, match-weighted averages, corrections, CSV safety and durable storage interruption/retry behavior. Disposable PGlite tests apply the real migration under production-style default grants and exercise RLS, allowed/denied roles, direct-write denial, normalization, idempotency, correction conflicts, event guards, management versions, and unchanged existing APIs. Browser fixtures are synthetic and do not contact production.

The production release must verify the exact deployed commit/assets and inspect new tables/RPC grants and migration state. Do not insert fictional competition or student records to test production. Authenticated two-device real-world scouting is still a team acceptance step, not something a local mock or schema inspection can prove.

## Coverage and current boundaries

Delivered core: match/pit scouting, phone-friendly counters, autosaved drafts, automatic reconnect outbox, safe retries, portable own-account backup, correction history, team notes/averages/comparison, report CSV, assignments/coverage, versioned shared picklist, and existing TBA/manual-match references.

Not yet included: Lovat’s timestamped action/timeline recorder, full-event schedule download, alliance score simulation/predictions, weighted/drag-and-drop picklist ranking, photos, scouting shift scheduling/notifications, exact Lovat export compatibility, or offline app cold-start. QR transfer is intentionally omitted because the requested workflow is cloud-first. No parity claim is made for the other features.

Reference workflow: [Lovat](https://lovat.app/), [official Lovat repository](https://github.com/HighlanderRobotics/lovat), and [2026 FIRST game manual](https://firstfrc.blob.core.windows.net/frc2026/Manual/2026GameManual.pdf). The reviewed Lovat monorepo did not have a blanket root/app license; one server manifest separately declares ISC. This implementation reuses no Lovat source or assets.
