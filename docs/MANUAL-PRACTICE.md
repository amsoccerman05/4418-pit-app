# Manual practice matches

Use **Matches → Add practice match** while an active Pit event is selected. Enter a recognizable label (for example, Practice 1) and optionally a start date/time in the device's local time zone. No TBA or Nexus event configuration is required.

Competition leadership creates and edits practice matches. The record opens directly into the normal battery assignment, pre-match checklist, and issue workflow. Active crew can complete checklist work using their existing permissions. A visible **Manual** badge separates these records from the official TBA match list; there are no invented alliances, scores, or external writes.

After the robot has finished its practice, leadership chooses **Finish practice → Confirm finished**. That records the authenticated actor and server timestamp, then offers the post-match checklist. It does not complete any checklist item or install, remove, cool, or otherwise change a battery. The crew records those actions separately.

## Preparation and readiness

- Open, unarchived manual practices take preparation priority over official matches. Practices are ordered by optional scheduled time, then label (numeric order) and immutable key. Finish or archive an open practice to move to the next preparation target. Official matches and qualification standings remain separately visible.
- Manual preparation uses the same assigned/installed battery and checklist readiness rules as official matches. The dashboard and pit display share that calculation.
- Every finished manual practice needs its own post-match inspection. Starting or finishing a later practice cannot hide an earlier missing inspection. Archiving does not clear that obligation or any incomplete required/blocking checklist items.
- Archive only removes the practice from the active list. **Show matches → Archived** retains its details, issue links, and checklist history. Existing checks can still be completed; a finished archived practice can still start its post-match inspection. Restore returns it to the active list.
- Label/time edits leave the immutable `manual:<UUID>` identity and existing checklist snapshots intact. Active labels are case-insensitively unique per event. Renaming a practice does not rewrite prior audit history.

## Connection safety

The existing signed-in-tab read-only snapshot and uncertain-save controls apply. Manual does not mean offline creation: create/edit/finish/archive/checklist writes require a current authenticated connection. A loaded tab can continue reading its last successful manual operations snapshot while disconnected, with **VERIFY STATUS** and stale labels. There is no offline write queue or automatic retry.

Creation uses a stable request UUID for the open editor. After a response is lost, refresh and review before resubmitting; a retry of the same request cannot create a second practice. Server-side version checks reject concurrent stale edits, and active-label uniqueness prevents two crews from creating the same label concurrently.

## Release

1. Verify production matches the existing competition schema and RPC definitions, including the current active-role/leadership helpers.
2. Apply the new `manual_practice_matches` migration in one transaction after authorization. It adds manual source/lifecycle metadata and an RLS-protected append-only audit table, changes the operations event reference to the existing Pit event, and updates the existing competition RPCs. Existing records default to TBA source; existing keys, notes, batteries, checklist runs/items and links remain intact. No new secrets or edge-function deployment are needed.
3. Deploy the frontend through the existing Pages pipeline only after the final build, Node/database and desktop/phone browser tests pass. The UI hides manual create until the server returns the migration capability marker.
4. Verify the exact release, read-only production context/permissions, and that existing record fingerprints are unchanged. Do not insert fabricated competition records into production to test the rollout.

Automated tests use synthetic local fixtures and in-memory PostgreSQL. They do not establish venue connectivity or a real crew's physical battery/checklist state. A real field practice is the appropriate end-to-end acceptance check when the crew is ready.

## Local verification — 2026-10-09

- TypeScript and production Vite build passed.
- Full Node/PGlite/SDK/component suite: 103 tests passed, zero failed or skipped.
- Playwright collection: 125 cases, including 22 new manual-practice desktop/phone cases. Browser execution was blocked before assertions by Chromium's `process_singleton_posix.cc` socket permission failure in this executor. Collection is not a browser pass; run the standard CI runner before release.
- Independent code review completed, with navigation races, committed-response-loss retry, official progress, archived-only issue reporting, and practice labels corrected and regression-tested.
- Read-only production preflight matched the current competition schema/RPC baseline. No production migration or real practice record was created during implementation.

## Next-practice shortcut and crew quick-start

**Add next practice** on the dashboard, practice details, or an existing practice list opens a reviewable draft. It suggests the next unused `Practice N` number after the event's numbered practice history, including finished and archived records. You can change the label and optional time before saving, or cancel without creating anything.

Each new practice has its own identity. It starts without a battery assignment, operational notes, scheduled time, or checklist runs. Use **Start checklist** to create new unchecked items from an active template. No previous completions, actors, issue links, or physical battery changes are copied. Earlier practices are not automatically finished, and unfinished post-match inspections remain visible in readiness.

The dashboard's expandable **Crew quick-start** is a phone-friendly reminder of preparation, battery checks, and post-run reporting. Its links open the existing screens; permissions and offline save gates are unchanged. It does not certify a complete battery inventory or replace a physical inspection. Missing battery records can be added by a mentor/admin in Batteries.

This follow-on UI release requires no database migration or new server capability beyond the already-deployed manual-practice API. No battery timers or inventory records are added.
