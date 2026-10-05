# Competition Operations V1 — KCMT field test

Pit-only extension. Existing issue/battery/event functions, data, Suite Auth and handoff are unchanged. The local navigation name is Competition Operations; the URL remains pit.frc4418.org.

## External contracts

Verified official TBA v3 OpenAPI 3.26.0 (`https://www.thebluealliance.com/swagger/api_v3.json`) and Nexus API 1.8.0 (`https://frc.nexus/api/v1/docs`). TBA supplies event name and team match records, scores and times. Nexus supplies live queue/status, estimated timing and announcements. TBA seconds and Nexus milliseconds are normalized to milliseconds. Negative TBA scores mean not yet scored. An actual start without a score is in progress/awaiting score, not the next unstarted match.

Nexus has human match labels rather than stable TBA match keys. Qualification/final matches are merged only when labels and both alliances agree; ambiguous playoffs/replays remain visible separately in Live event. No guessed match mapping. Qualification standings are documented in the weekend upgrades section below.

`competition-feed` validates the caller with Supabase Auth, requires an active profile, and reads the active event configuration through caller RLS. It uses only `TBA_API_KEY` / `NEXUS_API_KEY` server secrets, header authentication and fixed upstream hosts. No privileged database key. Browser Origin is allowlisted to https://pit.frc4418.org; origin alone is never authentication. Responses contain normalized public event data only.

Clients refresh at 30 seconds while visible on Dashboard/Matches/Event. Edge instances share in-flight requests and cache Nexus for 30 seconds, TBA matches and qualification standings for 60 seconds, event metadata for 5 minutes; ETags and upstream max-age are honored (bounded to 5 minutes). Cache is per warm instance, not a global rate guarantee. Timeout/failure retains last good data; Nexus snapshots older than 2 minutes are unavailable for live timing. Issues/batteries/checklists remain usable during upstream outages. No offline write queue.

## Local data and permissions

Migration `202610010001_competition_operations.sql` adds six RLS-protected tables and two authenticated RPCs plus one private capability helper. It changes no existing Pit function or record. Event config stores identifiers only. Match operations store stable TBA keys, battery, note and optimistic version. Battery assignment writes the existing battery history with metadata_updated; it does not install/remove/cool a battery. Issue associations use existing issue creation/management and audit.

Active mentors/admins manage Competition Operations. Active student/lead accounts need an unrevoked assignment to an active position in the existing Program, Functional Leads or Other Leadership classification. This capability does not grant existing stricter issue, event or battery administration. Active non-readonly members can start runs and complete items. Readonly can view only. Every mutation rechecks current server state. Direct table writes are denied.

Templates are versioned JSON item lists (1–60 items). Runs snapshot name/type/version/items with server starter/time. Item completion records authenticated actor and server time; stale versions fail. Template edits/archive never rewrite existing runs. Runs from completed events cannot be changed. Required incomplete work needs attention; incomplete blocking work or unresolved ROBOT DOWN prevents READY; unresolved HIGH needs attention. Existing incomplete event work stays visible and can continue blocking readiness. No physical action is inferred from a score.

## Rollout and KCMT verification

1. Compare existing Pit columns/constraints/function definitions against production; confirm the six new tables/functions are absent. Apply only this additive migration as one transaction.
2. Configure server secrets and deploy `competition-feed` with gateway JWT verification disabled: the function validates Bearer tokens via Auth getUser itself (supports current Supabase signing keys). Verify anonymous/inactive rejection and trusted-origin handling.
3. Deploy this Pit frontend through its existing Pages workflow after focused tests/build pass.
4. A Mentor creates/activates the correct upcoming event using existing Event controls; do not reuse a completed event merely because its name is KCMT. Leadership enters confirmed TBA/Nexus identifiers and team 4418. Verify event name, team matches, alliances, times and queue status against TBA/Nexus. No fabricated production matches/runs/issues are needed for deployment.
5. On an actual phone/tablet at KCMT, verify Hub handoff, dashboard, a real match's preparation, crew checklist completion attribution, battery assignment and explicit physical transition, and post-match inspection/issue association. Create the team's real templates. Check live fallback and actual event timing; automated fixtures do not prove venue connectivity or external match publication.

Do not add scouting, strategy, analytics, webhooks, notifications, attachments, competition attendance or automatic physical-state changes in V1.

## Deployment validation — 2026-09-30

Production preflight matched all 55 existing Pit columns, constraints/nullability and eight function bodies. Applied the additive migration once; existing event/issue/battery/history fingerprints and function bodies were unchanged afterward. New tables have RLS, no authenticated direct writes, no anonymous RPC access. Read-only production checks confirmed Mentor and an assigned Lead can manage; an ordinary student can view but cannot manage. Zero operations/runs were created.

`competition-feed` version 1 is active. Production anonymous requests return 401 and disallowed origins return 403. Both required secret names are configured. Upstream KCMT data remains a field/configuration check until identifiers are confirmed; existing completed KCMT records were not reused.

Focused local validation: 16 logic/database/handler-security tests, existing Pit workflow browser tests, seven Competition desktop/phone/tablet checks and two visual checks passed. TypeScript/build passed; Vite warns about the 527 KB JS chunk. No Suite Auth changes or unrelated repository tests. Frontend deployment uses the existing Pages pipeline.

## Weekend dashboard upgrades — implementation, 2026-10-05

- Dashboard readiness, its attention list, and the read-only pit display now share one calculation. A next-match assignment must be active and physically recorded ON ROBOT to show ROBOT READY. READY means available to install and still needs attention. Unavailable/inactive batteries and assigned-versus-installed mismatches block readiness. These checks do not change battery status or checklist history.
- Existing incomplete required/blocking event work remains visible. The latest completed match needs its post-match inspection. After that inspection is complete and no next match is published, completed preparation does not keep the robot blocked for a nonexistent next match; the dashboard says CHECKS CLEAR.
- Issue lists show owners, distinguish Unassigned from an unavailable assigned profile, and offer an independent Owner filter (All owners / Mine / Unassigned). Dashboard repairs, match issues, and the pit display show owners too.
- Open pit display on Dashboard for a large-text monitor/tablet view. Close or Escape returns to the dashboard. It refreshes with the existing data polls, shows separate issue/battery and checklist timestamps, and replaces the readiness headline with VERIFY STATUS when local data is stale or disconnected. Schedule/queue freshness is labeled separately. No offline write queue or automatic physical transitions were added.
- Main-page standings use TBA `/team/frc{team}/event/{event}/status`, verified against official OpenAPI 3.27.0 on 2026-10-05. Only `qual.ranking.rank`, `qual.num_teams`, and `qual.ranking.record` are displayed. The record is explicitly qualification W–L–T, not playoffs, all-match totals, or season totals. Missing data stays unavailable rather than becoming zero. Validated last-known data may be retained on failure, with its original check time and a stale label. A successful unpublished response clears the old standing. Browser snapshots cannot cross event, team, or configuration revisions.

### Release requirements for these upgrades

No database migration and no new secret are required. Deploy the updated `competition-feed` function, including `standings.ts`, using the existing authenticated handler setup (`--no-verify-jwt`, because the handler verifies the caller itself). Then deploy the frontend using the existing Pages workflow. The ranking card remains unavailable until the updated function is running and TBA publishes qualification standings.

This section records source implementation only. Do not infer a production rollout from it. Before release, run `npm ci`, `npm run build`, `npm test`, and `npm run test:e2e`. After authorized deployment, verify the exact deployed version, an authenticated event feed, the actual event identifiers, and a phone/tablet mock match including a real battery swap and Wi-Fi loss. Local fixtures do not establish production publication or venue connectivity.
