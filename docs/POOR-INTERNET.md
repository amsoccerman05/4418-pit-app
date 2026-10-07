# Poor-internet competition view

## What works

Open Competition Operations and load the current event while connected. If that tab then loses internet or a read fails, its last successful schedule, robot issues, batteries, and checklist snapshot remain readable. The dashboard and large pit display replace readiness claims with **VERIFY STATUS**, show original successful-read/provider timestamps, and clearly identify offline or stale data.

- Private Pit snapshots stay only in the signed-in tab's React memory. This change does not persist Pit data to localStorage, sessionStorage, IndexedDB, Cache Storage, or a service worker.
- It is **not offline cold-start/reload support**. Keep the loaded tab open. A reload, closed tab, sign-out, switched account, expired session, explicit access rejection, or inactive profile removes the snapshot. A private snapshot also expires after eight hours without a successful Pit read, even with a longer session.
- Existing session handling and server permissions remain authoritative. No offline sign-in or access override is introduced. A server-side revocation cannot be learned during a disconnection; the view clears when session expiry or the next observed authorization/profile check indicates access is unavailable.
- Event, team, and config changes clear incompatible schedule snapshots. Requests from an older account or event cannot replace the new view.
- Issues/batteries become read-only after a failed read or 60 seconds without a successful read. Checklist operations also become read-only on a failed context read or after 90 seconds. A provider outage alone does not disable otherwise-connected internal Pit work.
- TBA schedule/standings retain provider timestamps and are stale after five minutes. Nexus live labels stop immediately while offline or after errors, and after two minutes without a valid live snapshot.
- Requests time out after 12 seconds; read refresh storms are single-flight. Reconnection, focus, and existing polling refresh reads. Manual **Retry connection** refreshes both Pit and competition data without clearing the last good snapshot first.

## Saving safely

There is no offline mutation queue, background sync, or automatic mutation replay. Offline/stale controls are disabled and handlers also check connection/scope before dispatch. A lost write response is shown as **Save not confirmed** because the server may have committed before the connection failed. Controls stay locked until the user explicitly refreshes and reviews the latest record. Do not repeatedly submit a new issue, measurement, or checklist while its outcome is unknown. Existing server-side version/status checks remain in force; no database schema or RPC signature changed.

Mutations pin the reviewed actor's access token and carry the account/session cancellation signal through the shared sign-in broker. Changing accounts while the broker is waiting cancels the old operation instead of sending it under the next account. Post-save reads supersede pre-save reads, and delayed save completions cannot dismiss a different editor.

## Verification

All automated fixtures are synthetic and local. Node tests use in-memory PostgreSQL and mocked HTTP/session responses. Browser tests add desktop and phone scenarios in `tests/offline.spec.ts`, including real browser offline/reconnect events, dropped reads, held/out-of-order requests, account change/logout/inactive/expired sessions, private-storage audit, and a committed battery write whose response is lost. `tests/pit-dispatch.test.mjs` exercises account cancellation with the actual installed Supabase SDK and suite broker, without network access.

Run:

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Local Chromium launch in the current implementation environment is blocked before test assertions by `process_singleton_posix.cc:297 socket() failed: Operation not permitted`, including approved escalation. Browser execution and visual QA therefore still need the repository's standard GitHub Actions runner (after publication is authorized) or another supported browser environment. No production accounts or data were changed to test this work.

Before using it at an event, complete a two-device connected smoke check and a loaded-tab airplane-mode/reconnect check. Readiness is an old observation while disconnected; confirm physical battery, repairs, and checklist completion with the pit crew before queueing.

### Local check result (2026-10-07)

- Production TypeScript/Vite build: passed.
- Node/database/component/SDK/hook tests: **79 passed**, zero failed/skipped.
- Playwright collection: **103 cases** discovered, including 22 new offline desktop/phone cases. Collection is not execution; browser assertions and screenshots remain unverified in this environment.
- Independent scoped-code review: completed; identified access/callback races were fixed and covered by deterministic regressions.
- Base verified against remote `main`: `8fb5b81c90a237a9be9867e7045f6b7099e78ec2`.
