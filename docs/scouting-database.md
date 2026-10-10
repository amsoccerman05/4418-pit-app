# Scouting database contract

Migrations:

- `supabase/migrations/20261010013034_competition_scouting.sql` establishes scouting.
- `supabase/migrations/20261010142916_scouting_driver_station_assignments.sql` adds event-scoped driver station assignments.

This is additive to the existing Pit Operations, Competition Operations and manual-practice migrations. It does not rewrite Inventory data, profiles, authorization roles, or existing public RPC definitions. The implementation is independent of Lovat and uses no Lovat code or license.

## API

- `pit_scouting_context(event_id)` returns `can_scout`, `can_manage`, `observations`, `assignments`, and `picklist`. All arrays are scoped to the selected local Pit event. Observations include the entire correction chain; analytics must exclude IDs referenced by another observation's `supersedes_id`.
- `pit_scouting_submit(p)` accepts `{id, event_id, kind, team_number, match_key, data, supersedes_id?}` and returns the submitted UUID. `kind` is `match` or `pit`; pit reports require a null/absent match key. The game schema version is `data.schema_version: 1`.
- `pit_scouting_manage(action, p)` returns a row UUID. `action: assignment` supports the driver station and legacy targets below. Null `assignee_id` clears the assignment. `action: picklist` accepts `{event_id, team_number, rank, status, notes?, version}`. Picklist statuses are `available`, `picked`, or `avoid`; rank ties are sorted by team number. For either action, version 0 creates a row; existing rows require their current version and increment it atomically.

Submitted observation rows include `created_by` (the actual submitting account), `created_at` (server time), and `scout_id` (the original scout, unchanged by corrections). Assignment/picklist rows have server-stamped `updated_by` and `updated_at`. Caller-supplied authorship/timestamps and other unknown top-level fields are rejected.

## Assignment targets

Driver station coverage is for the selected local Pit event, across its matches. It accepts `{event_id, kind: "match", alliance, station, assignee_id, notes?, version}`. `alliance` is exactly `red` or `blue`; `station` is a JSON whole number 1–3. `team_number` and `match_key` must be absent or null. An assignment to Red 1 does not mean qualification match 1, team 1, or a permanently assigned robot.

There are six possible event slots: Red 1, Red 2, Red 3, Blue 1, Blue 2, and Blue 3. A unique `(event_id, kind, alliance, station)` index permits one row and one current assignee per station. Clearing an assignee keeps the row, notes and version history. Different stations may intentionally share the same scout; this is not a database uniqueness violation. Clients should warn about that choice. Station coverage does not populate report team numbers: each match's team still needs to be chosen or verified against its schedule.

Existing match/team assignments continue to accept `{event_id, kind: "match", team_number, match_key, assignee_id, notes?, version}`. Pit assignments keep `{event_id, kind: "pit", team_number, match_key: null, assignee_id, notes?, version}`. Both use absent/null `alliance` and `station`. Existing match keys still normalize and validate with the original helper. Contradictory station and team/match targets are rejected, rather than silently discarding one target.

The upgrade only adds nullable `alliance` and `station` columns, permits a null team for station targets, and replaces the target-shape check with an explicit legacy-or-station constraint. Legacy assignment IDs, target fields, notes, assignees, versions and timestamps are preserved; new fields are null. No historical match number is converted to a driver station. Existing audit JSON is untouched. New station changes append the same before/after audit events, including station identity. Public RPC signatures and invoker wrapper definitions stay unchanged. Context returns the new fields and orders station rows Red 1–3 then Blue 1–3, with legacy match/team and pit rows also retained.

## Schema 1

Match fields are `schema_version`, `match_label`, `alliance`, `station`, `start_position`, `auto_fuel`, `teleop_fuel`, `auto_climb`, `endgame`, `accuracy`, `role`, `traversal`, `intake`, `driver`, `defense`, `disabled`, `no_show`, and `notes`.

Pit fields are `schema_version`, `drive`, `intake`, `capacity`, `traversal`, `climb`, `auto_notes`, and `notes`.

All schema fields are required and unsupported fields are rejected. Fuel is null (not observed) or an integer from 0–999; capacity is null or 0–200. Driver/defense are null or 1–5; station is null or 1–3. All choices are explicitly enumerated in the migration and frontend model. Auto climb, endgame and robot role include `unknown`; unknown is never silently interpreted as failure or zero. Notes are strings of at most 2,000 characters. Match labels are 1–100 nonblank characters. Fuel counts are scouting observations, not official scores.

## Identity and retry behavior

- The client generates one UUID once and retains the exact request payload until the server acknowledges it.
- Retrying that UUID with the same JSONB payload and the same still-authorized actor returns the original UUID without inserting another record. Retries still succeed after the event is completed. JSON object key order does not matter.
- Reusing a UUID with any different payload or a different actor is rejected. Even changing a match-key alias on a retry changes the payload; clients must resend the original payload.
- A different UUID for the same original scout/event/kind/team/match is rejected. Another scout's independent observation is permitted.
- Qualification and playoff aliases are canonicalized. `2026test_QM0017` and `qm17` become `qm17` when the event's configured TBA key is `2026test`; leading/trailing spaces and case normalize. `p001` becomes `p1`, and `qf02m03` becomes `qf2m3`. Match numbers must be positive. Free-form practice identifiers use `practice:<token>`. Existing `manual:<uuid>` keys are checked against the same event's manual-practice record.
- A configured external event prefix cannot refer to another event. Once scouting observations, assignments, or picklist data exist, the configured TBA event key cannot be changed; use a new local Pit event. Other configuration metadata remains editable.
- New observations, corrections and management writes require the event to be active. Queued requests that were never accepted before an event closed remain unsent; do not silently switch their event identity.

## Corrections and permissions

Observations and request receipts are append-only. A correction is a new UUID with the latest observation's `supersedes_id` and the same event, kind, team and match identity. Only the original scout or current competition leadership may correct it. A unique successor constraint and row lock reject stale competing corrections. The original scout retains correction ownership after a leader correction.

Active `readonly`, `student`, `lead`, `mentor`, and `admin` profiles can read scouting. Students, leads, mentors and admins can submit. Shared picklists and assignments use the existing `pit_private.competition_manager()` helper: mentors/admins and active program/functional/other leadership positions. A `lead` profile without a qualifying current position is not automatically a competition manager. Parents/guests are not added to existing access rules. An assignment does not grant submission permission or allow submitting as the assignee.

Public RPCs are invoker wrappers around checked private implementations. Every private operation rechecks trusted active profiles, never editable JWT metadata. All new public tables have RLS and authenticated read-only grants. Anonymous access, direct writes, direct history edits and private receipt reads are denied, including in projects with permissive default grants. Every assignment and picklist change appends a before/after audit event with the authenticated actor.

## Verification and deployment

Run `node --test tests/scouting-stations-db.test.mjs tests/scouting-db.test.mjs tests/competition-manual-db.test.mjs tests/database.test.mjs`. The disposable PGlite suites apply the prerequisite migrations followed by the station migration. The station suite also seeds legacy assignments and audit records before the upgrade, then verifies their exact preservation alongside all public RPC definitions and grants. They check production-style default grants, role/position revocation, null/type/range validation, all six slots, intentional repeated scout assignments, target-shape constraints, exact retries, duplicate identity, append-only corrections, competing stale saves, clear/reassign audit trails, event isolation, identity-rebinding protection and preservation of existing data/APIs.

PGlite queues queries within one embedded PostgreSQL instance; its competing-request tests verify conflict outcomes, not true multi-session lock scheduling. A staging PostgreSQL deployment should also exercise simultaneous client submissions and corrections. The migration includes database unique constraints, per-request advisory locks, shared event-identity locks and row locks for that purpose.

Both migration files were created with Supabase CLI 2.119.0. The station upgrade passed the original scouting regression suite and its own pre-upgrade/post-upgrade fixture suite. Local CLI advisors and migration-list commands could not connect because no local Supabase PostgreSQL server was running on port 54322. No production migration or data changes were performed during database implementation. Run advisors and normal staging/deployment checks against the authorized target before promotion.
