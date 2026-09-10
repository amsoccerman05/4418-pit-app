# 4418 Pit Operations

A mobile-first competition pit workspace for FRC Team 4418 IMPULSE. This is a separate application from Team 4418 Inventory. It uses the same Supabase Auth users and existing `public.profiles`; it never creates a second user/role system.

## Run locally

Use Node 24 and npm:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Set `.env.local` to the **existing Inventory Supabase project's** URL and public anon key. Both are public frontend configuration; never use a service-role key. No credentials are committed. Without configuration, the welcome page provides setup guidance and an explicit **Explore local demo** button. The demo stores sample data in localStorage under `4418-pit-demo-v1`, includes a clearly labeled role switcher, and never contacts Supabase. Demo data is not uploaded when signing into the real workspace. Real data always requires an active authenticated profile.

## Manual Supabase setup (required)

1. In the existing Inventory project's SQL editor, verify `public.profiles` has `id uuid`, `display_name text`, `role` (text or compatible enum), and `active boolean`. This contract was confirmed in the neighboring Inventory repository, but the deployed database must match it. The migration fails transactionally if the columns are missing. Do **not** run Inventory migrations in this repository or create duplicate profiles.
2. Run **`supabase/migrations/202609090001_pit_operations.sql` once**, as an owner through the SQL editor or your trusted migration pipeline. It is intentionally not run by this application. It creates only Pit tables/functions/schema/indexes/policies and adds the Pit tables to `supabase_realtime` if that publication exists. It does not alter Inventory tables, profile policies, or authentication triggers. The migration is transactional and is not intended to be rerun after success.
3. Verify `pit_events`, `pit_issues`, `pit_batteries`, `pit_battery_events`, and `pit_issue_events` are enabled under the `supabase_realtime` publication. If the publication did not exist at migration time, enable these tables manually in Supabase's replication/publications settings.
4. Sign in using an existing active admin or mentor account. Create an event under **Manage**, then **Activate event**. Add batteries under **Batteries → New battery**. New batteries begin in TESTING; check them and mark ready. No fake event or battery seed is inserted into production.
5. Use existing Inventory account administration / Supabase Auth for invitations and password resets. Password login is provided here; account creation and recovery flows remain with the existing account system. Add `https://pit.frc4418.org` to allowed auth redirect URLs if you later enable redirect-based login or recovery here. Do not replace Inventory's existing Site URL or redirects.

Tables:

| Table                | Purpose                                                                        |
| -------------------- | ------------------------------------------------------------------------------ |
| `pit_events`         | Competition context, dates, activation, preserved historical events            |
| `pit_issues`         | Numbered issues, severity, diagnostics, resolution, assignee, optional battery |
| `pit_issue_events`   | Append-only meaningful field changes with server-attributed actor/time         |
| `pit_batteries`      | Shared fleet, status, labels, notes, active/archive flag                       |
| `pit_battery_events` | Status transitions, optional voltage/match, issue links and metadata activity  |

## Permissions and integrity

RLS is enabled on all five Pit tables. Authenticated **active** shared profiles may read; anonymous and inactive accounts cannot read Pit rows. Client table writes and history edits are denied for every role. Mutations use narrowly scoped transactional RPCs that read the real role from `public.profiles`, reject insufficient access, and set actors/timestamps on the server. SECURITY DEFINER functions have an empty search path and explicit execute grants. User metadata and browser role values are never trusted. No new grants or policies are applied to Inventory objects.

| Role           | Permissions                                                           |
| -------------- | --------------------------------------------------------------------- |
| readonly       | View only                                                             |
| student        | Report issues; battery workflow and measurements                      |
| lead           | Student access plus issue management and release flagged batteries    |
| admin / mentor | Full Pit operations, event and battery management, retirement/archive |

Students cannot release FLAGGED batteries. Only admins/mentors may retire or restore RETIRED batteries. Retire before archiving; reactivate before changing archived battery status. History remains readable. Deletion is deliberately absent so competition records are preserved.

A unique partial index allows one active event. Activation completes the preceding event atomically. A second partial index and transaction lock prevent multiple installed batteries. The dashboard also handles multiple ON ROBOT records defensively with a warning. Battery commands check the expected status; issue edits check `updated_at` to reject stale overwrites. Writes and history records commit together. A battery issue link appears in both issue detail and battery history.

Robot status uses unresolved issues in the active event: ROBOT DOWN → NOT READY; HIGH → NEEDS ATTENTION; otherwise READY. **DEFERRED is unresolved**, so deferring a serious issue does not silently make the robot ready. No event produces NO ACTIVE EVENT, not READY. Readiness reflects reported issues, not a separate inspection process.

Batteries are a shared fleet across events. Their activity is stamped with the active event when present. The latest recorded voltage is explicitly labeled with measurement kind and time; it is not assumed to be a live reading. Voltage never drives health scoring.

## Battery quick actions

The Batteries page header offers **Add battery** only to admins and mentors. Issue reporting stays on the Dashboard and Issues pages.

- **Install on robot** remains one tap without a match. **Install with match** opens an optional match field (for example `Q42`, `SF3-1`, or `F2`).
- **Remove battery** opens a quick dialog with Match (prefilled from the installation), optional post-match voltage, and Cooling / Testing / Flagged as the next status.
- **Start charging** and **Mark ready** remain one tap. **Ready with voltage** records an optional voltage as part of marking a charging battery ready.
- Battery cards and detail show **Assigned: Q42** while installed, then **Last used: Q42** after removal. The dashboard current battery also shows its assignment. These labels come from installation/removal history and do not reuse an older match for a new, unmatched installation.

No additional migration is needed: the existing `pit_battery_events.match_number`, `voltage`, and `voltage_kind` fields and role-checked transition RPC support these changes. Auth, RLS, and Inventory tables are unchanged. Issue photos remain deferred because no photo upload/storage support exists in this app.

## Realtime and connection handling

Subscriptions cover issues, batteries, both histories, and event changes, with cleanup on logout/unmount. Profile changes are subscribed when the existing profile publication permits them. A 20-second refresh and focus refresh provide fallback and recheck active profiles. Stale write conflicts are shown rather than silently overwritten. Offline writes are not queued; errors keep forms open. Realtime shows its connection state separately from last refresh time. Changes update the current device after a successful save.

## Repository structure

```text
src/
  main.tsx          Auth, responsive pages, forms, accessible dialogs
  style.css        Team green/off-white UI and responsive layouts
  model.ts         Types, role predicates, readiness and battery workflow
  client.ts        Public Supabase configuration
  repository.ts    Supabase reads/RPCs and local demo mutations
  demo.ts          Explicit local sample data
supabase/migrations/202609090001_pit_operations.sql
tests/database.test.mjs  Real PostgreSQL semantics via PGlite: migration, RLS, RPC integrity
tests/workflows.spec.ts  Browser acceptance and responsive checks
.github/workflows/pages.yml
```

## Checks

```sh
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Database tests create a disposable in-memory PostgreSQL database and minimal shared profiles/auth fixtures, apply the **actual** migration, then execute calls as authenticated/anonymous roles. They do not connect to the team project. Browser tests run the explicit local demo and cover the three requested acceptance scenarios, event administration, read-only UI, and 390/768/1280/1440px overflow checks. To use an installed Chromium browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable. CI installs Playwright Chromium.

Before competition, also run a two-account/two-device smoke test against the actual Supabase project: report a ROBOT DOWN issue as student, confirm the other dashboard updates, resolve as lead, and run B07's installation/cooling/charging/ready cycle. Confirm readonly writes fail and a disabled profile loses access. Local tests cannot verify your hosted auth settings or publication delivery.

Verified locally: TypeScript and production build pass; all 11 database/readiness/match-label tests and all 18 browser tests pass. Browser acceptance scenarios run on both desktop and a 390px touch viewport. Dashboard and battery screenshots were visually reviewed at phone and desktop sizes. Test screenshots are generated under ignored `test-results/`. Browser tests use their own server on port 4419. The local development server uses port 4418 to avoid the Inventory app’s default Vite port.

## GitHub Pages and domain

The workflow checks TypeScript/build, database tests and browser tests before deployment. PRs run checks only. Pushes to `main` and manual runs deploy via the `github-pages` environment when configuration is present. Production hookup now configures only this Pit repository and deploys through this workflow. See [production verification notes](docs/PRODUCTION-HANDOFF.md) for status and remaining authenticated smoke tests. Inventory/www settings and DNS are not modified.

1. Push this repository to `amsoccerman05/4418-pit-app`.
2. In **Settings → Secrets and variables → Actions**, set repository variable `VITE_SUPABASE_URL` and repository secret `VITE_SUPABASE_ANON_KEY` using the existing project's public values. The anon key will be bundled publicly; secret storage is only convenient CI configuration.
3. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**. Run the workflow. The relative Vite base supports `https://amsoccerman05.github.io/4418-pit-app/` before the domain is attached.
4. When ready, set **this repository's** Pages custom domain to `pit.frc4418.org`.
5. At the DNS provider for `frc4418.org`, add a **CNAME** for host **`pit`**, target **`amsoccerman05.github.io`** (not a URL and not a repository path). If Pages is moved to a different owner, use that owner's Pages hostname. Leave `www`, root, and `inventory` records unchanged. Wait for DNS verification, then enable **Enforce HTTPS** on this repository's Pages settings.

There is no CNAME file: custom GitHub Actions deployments use the repository Pages custom-domain setting. References: [GitHub custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [GitHub custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site), [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

## V1 boundaries / next iteration

No photos, offline write queue, scouting, match APIs, inventory integration, tasks, analytics, QR codes, or health scoring. Navigation is intentionally simple and does not deep-link individual records. Histories are fully fetched in paginated batches for the initial small team workload; introduce event-scoped queries and incremental history loading if volume grows. Existing user accounts are reused, but browser sessions on separate domains still require their own sign-in. This repository has not changed the live Supabase project or verified its credentials.

Recommended next small iteration: run a practice-match session with the pit crew, tune the status labels/actions from their feedback, then add compressed, authenticated issue photos in a separate Pit Storage bucket if needed.
