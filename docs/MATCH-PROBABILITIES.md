# Dashboard match probabilities

The next-match card displays Statbotics's pre-match win estimate for the exact upcoming official match and red/blue team lineup. It remains informational and never changes robot readiness, checklists, scouting, batteries, or production records.

## Provider contract

- Public keyless `GET https://api.statbotics.io/v3/matches?event=<TBA event key>&limit=1000`, cached for at least 60 seconds (upstream cache directives may extend this to 5 minutes).
- Official OpenAPI: https://api.statbotics.io/docs and https://api.statbotics.io/openapi.json.
- Response schema: https://github.com/avgupta456/statbotics/blob/master/backend/src/db/models/match.py (`to_dict`). Read `pred.red_win_prob`, a number from 0 through 1; never read result scores, team EPA, `epas`, or `pre_epas` as a probability.
- Units and complementary blue estimate follow Statbotics's own UI: https://github.com/avgupta456/statbotics/blob/master/frontend/src/pagesContent/match/%5Bmatch_id%5D/summary.tsx. Red is `p * 100%`; blue is `(1 - p) * 100%`. The API has no separate tie probability; the UI says so and makes no claim of a guarantee.
- Model timing: https://github.com/avgupta456/statbotics/blob/master/backend/src/models/template.py records the prediction before updating the model with a match result. This is a pre-match estimate, never live in-match odds.

## Data safety and freshness

Event, canonical qualification/playoff match key, and both alliance rosters must agree. Manual practices, completed/in-progress matches, absent predictions, changed lineups, and missing or mismatched events do not get a percentage. Zero and one are valid values; null or missing values are unavailable. Non-numbers, non-finite values, out-of-range values, duplicate identities, invalid alliances and full potentially truncated pages are rejected.

A successful empty/unpublished response clears older data. An outage preserves the last validated snapshot with its original check time for diagnostics, only inside the same event. Client fallback additionally requires the same event ID, team, and config version. The UI suppresses percentages when the schedule or provider is unavailable, offline, older than five minutes, or has an implausible future timestamp. “Last checked” is our successful fetch time, not the model's generation time.

No new API credentials or migrations are required. Deploy the updated competition-feed function alongside the dashboard. An older feed deployment safely displays unavailable. Live Statbotics endpoints returned upstream 500/503 during implementation; local tests use clearly synthetic fixtures against the verified schema. No live KCMT probability was verified or fabricated.

## Verification

`tests/match-probability.test.mjs` covers units, complements, exact identities and alliances, boundary and invalid values, missing data, freshness and cross-event/config fallback. `tests/display-feed.test.mjs` covers the public URL and independent error handling. `tests/competition-edge.test.mjs` runs the real handler with isolated dependencies. `tests/match-probability.spec.ts` checks desktop/phone display, zero/one, unavailable states, schedule failure, lineup change, manual practice, next-match change and no upcoming match. It performs no production writes.
