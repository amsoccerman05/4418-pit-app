# Production setup and verification

Updated September 9, 2026 after the owner confirmed the migration and auth redirects. The Pit repository now has GitHub Actions Pages enabled, public Supabase build configuration supplied, and custom domain `pit.frc4418.org` configured. No production seed data, Inventory changes, or DNS changes were made. Application commit `e547b26020ad7649b6f959f0ba62a70f81c5ad3d` deployed successfully: [Actions run 34435046390](https://github.com/amsoccerman05/4418-pit-app/actions/runs/34435046390). Both check and deploy jobs passed. The owner added DNS; the CNAME now resolves correctly. HTTPS certificate provisioning remains pending.

## Confirmed configuration

- Repository: `amsoccerman05/4418-pit-app`; local and remote default branch: `main`.
- Existing project: `https://tuxwavmjvjfhmaddchtr.supabase.co`, taken from Inventory's local configuration.
- Pit `.env.local` now contains only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The key was verified as a public publishable key, not a service-role key. The file is ignored by Git and restricted to its owner. No key is included in this document.
- GitHub authentication works over the network. Pages was enabled for the Pit repository with `build_type: workflow`.
- Inventory's existing Pages site uses a GitHub Actions workflow, custom domain `inventory.frc4418.org`, and enforced HTTPS. It was inspected read-only.
- The Pit workflow already uses the same Actions / Pages deployment approach. Repository variable `VITE_SUPABASE_URL` and repository secret `VITE_SUPABASE_ANON_KEY` are configured.

## Live Supabase findings

All five Pit tables and all six write RPCs reject anonymous access with PostgreSQL permission code `42501`; all 11 live anonymous checks passed. The earlier missing-table responses were resolved by the owner's migration. Authenticated profiles, successful writes, and cross-client realtime delivery still need real test-account sessions; no authenticated credentials are committed or inferred from the public key.

Run `node scripts/verify-live-access.mjs` to repeat the live anonymous read/RPC checks. For existing test accounts, optionally create git-ignored `.env.live-test` with `PIT_TEST_<ROLE>_EMAIL` and `PIT_TEST_<ROLE>_PASSWORD`, where ROLE is READONLY, STUDENT, LEAD, ADMIN, or MENTOR. Never paste passwords into chat or commit that file. The script verifies the signed-in user's active shared profile, table reads, and forbidden RPCs using empty, non-insertable payloads. It does not create records, users, or change roles. Missing accounts are explicitly reported as NOT TESTED.

## Migration completed

The owner confirmed `supabase/migrations/202609090001_pit_operations.sql` was applied successfully. Subsequent live API checks confirm all five Pit tables now return `401 / 42501` to anonymous reads. Do not rerun the initial migration. No additive migration is currently required.

To inspect realtime publication membership from the SQL editor:

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename like 'pit_%'
order by tablename;
```

Expect all five Pit tables. Actual cross-client delivery still needs authenticated sessions.

## Auth redirects confirmed by owner

The owner confirmed these were added under **Authentication → URL Configuration → Redirect URLs**:

```text
https://pit.frc4418.org/
https://pit.frc4418.org/?password-reset=1
```

Preserve the current Site URL and every existing redirect, including:

```text
https://inventory.frc4418.org/
https://inventory.frc4418.org/?password-reset=1
```

Preserve all localhost development URLs. If absent, add the Pit development origin `http://localhost:4418/` and `http://localhost:4418/?password-reset=1` (and the equivalent `127.0.0.1` URLs if that host is used). Do not replace Inventory's Site URL with Pit's.

Pit currently uses existing account/password sign-in. It does not implement its own password-reset form; account recovery remains with the existing Inventory account system. Adding the requested allowlist URLs does not add a new recovery workflow.

## RLS and role audit

The prepared migration enables RLS on every Pit table, grants authenticated users SELECT only, and checks an active shared profile for reads. All client table writes are denied, including direct writes by admin accounts; role-checked transactional RPCs perform authorized mutations. Actors are taken from `auth.uid()`, never supplied roles or user metadata. SECURITY DEFINER functions use an empty search path and explicit execute grants.

- readonly: read only.
- student: report issues; normal battery workflow and measurements; no event/battery management.
- lead: student permissions plus issue management and release of flagged batteries.
- admin/mentor: event and battery management, retirement and other Pit operations.
- inactive/anonymous: no Pit data access.

Local disposable-PostgreSQL tests cover the actual migration, role denial, direct-write denial, fabricated actor rejection, stale updates, battery lifecycle, and preservation of existing Inventory data. The current local suite has 11 database/model tests. The latest browser suite has 18 passing desktop/phone tests, including match labels, removal, optional voltage, admin event/battery creation, and 390/768/1280/1440px layout checks. These results **do not constitute a live RLS or authenticated role verification**; authenticated production sessions are still required.

No additional RLS migration was identified from the local audit. Authenticated deployed permissions still require the existing test accounts.

## Pages, DNS and HTTPS

Confirmed owner and Pages hostname: `amsoccerman05` / `amsoccerman05.github.io`.

The owner added this DNS record, and it was verified through DNS:

| Type  | Host  | Target                    |
| ----- | ----- | ------------------------- |
| CNAME | `pit` | `amsoccerman05.github.io` |

Do not include `https://` or `/4418-pit-app` in the target. Do not alter root, www, or inventory records. No DNS record was changed by this pass.

The Pit repository's Pages source, build values, and custom domain are configured. Pushes to `main` run the verification and deployment workflow. The DNS record above is already present. The attempted `https_enforced=true` update returned “The certificate does not exist yet”; the Pages API reports `https_certificate: null` and `https_enforced: false`. A normal HTTPS request failed hostname certificate validation. Do not bypass certificate checks or sign in over HTTP. Once GitHub provisions the certificate, enable **Enforce HTTPS** in this repository’s Pages settings (or resume the deployment agent to recheck and enable it).

## Still required before calling this production-ready

1. Confirm realtime publication membership if cross-client delivery does not work; the migration is already applied.
2. Auth redirect additions are owner-confirmed; preserve Inventory and localhost settings.
3. Authenticated checks using existing active team accounts for the five roles, without sharing passwords or service-role keys in chat.
4. DNS and deployment are verified. Wait for the custom-domain certificate, enable HTTPS, and verify the secure URL.
5. Two signed-in client tests on the deployed app: a student reports an issue and another dashboard updates; a battery transition propagates to the other page/dashboard. Confirm these arrive through realtime, not merely the 20-second refresh fallback. Verify cleanup on logout.
6. Mentor/admin creates real events and batteries manually. Test activation/completion, battery editing/retirement, student normal workflow, match labels, optional voltage, readiness and readonly/direct API denials using an owner-approved test plan. Do not automatically insert fake competition records.
7. Repeat responsive and authenticated smoke tests against the deployed URL.

Sources: [GitHub custom subdomains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site), [Supabase redirect allowlist](https://supabase.com/docs/guides/auth/redirect-urls).
