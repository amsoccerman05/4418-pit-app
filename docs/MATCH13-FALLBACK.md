# Match13 prediction backup

Statbotics remains the preferred pre-match probability provider. When its exact match prediction is missing, invalid, stale, or unavailable, the competition feed can use Match13. Event EPA stays Statbotics-only; the app never blends ratings or interprets EPA as a probability. Recovery automatically selects Statbotics again.

## Server setup and release

1. Apply `20261010172105_match13_shared_prediction_cache.sql` to the existing project. It creates only a singleton cache of public Match13 data and two service-role-only RPCs. RLS is enabled; anonymous and authenticated clients get no access. No team, scouting, checklist, battery, or assignment records are changed.
2. In the project's Supabase Dashboard → Edge Functions → Secrets, enter the existing Match13 key as `MATCH13_API_KEY`. The user must enter and save it directly. Never place it in chat, source code, browser storage, a `VITE_` variable, logs, or an API response.
3. Deploy all `supabase/functions/competition-feed` files, retaining existing custom user authentication and origin restrictions. The existing built-in service-role credential is used only for cache RPCs; team reads still run with the requesting user's token.
4. Deploy the dashboard after tests pass. An absent key, missing migration, or older feed safely leaves the backup unavailable.

## Verified provider contract

Source: https://www.match13.com/docs/api (official client-rendered documentation).

- Fixed server-only endpoint: `GET https://actions.match13.com/v1/events/<eventKey>/matches?scope=all`; `scope=all` includes offseason events.
- Bearer authorization is sent only to this fixed HTTPS host. Redirects are rejected; browser clients never call Match13 directly.
- Envelope: `{eventKey, year, matches}`. Each match has its canonical `key`, optional `bye`, `pred`, and `teams` dictionary keyed by numeric team number.
- `pred.winProb` is the red alliance's chance of winning, in [0,1]. Blue is `1 - red`; no separate tie estimate is published.
- The team dictionary does **not** publish alliance colors. Dictionary order is never used. The feed joins the exact match key and all six unique teams to a fresh TBA schedule, then copies TBA's red/blue rosters. This validates match identity and the six-team set, but cannot independently verify Match13's alliance-color assignment. The UI discloses this limitation.
- No per-match model timestamp is published. `match13At` is our successful fetch/revalidation time, labeled “Fetched.” It is never presented as the model generation time.

## Cache and quotas

Match13 documents limits of 60 requests/minute, 1,000/hour and 30,000/week; 304s and failures count. Current-season responses specify a 60-second private cache; completed seasons specify 86,400 seconds. ETags are used with `If-None-Match`.

One database row and an atomic refresh lease share the cache across all callers, devices, Edge isolates and event-config changes. At most one Match13 attempt per minute is admitted by this app (at most 10,080/week continuously, before longer upstream cache/backoff). This cannot account for another app independently using the same key. Concurrent requests serve only a still-fresh validated snapshot; otherwise they report unavailable. Cache errors never fall through to an uncached upstream request.

Successful 200/304 results honor `Cache-Control` up to the documented one-day value. Errors preserve only validated data and its original timestamp. `Retry-After` is respected globally, including on 429; there are no immediate retries. Requests time out and never log upstream problem bodies. Only normalized public event keys, team numbers, probabilities, ETags, timestamps and a fixed failure message are stored.

## Display gates

Both providers require the exact upcoming official match and matching red/blue rosters. Manual practice, started/completed matches, missing or conflicting identities, stale schedules, changed rosters, duplicate keys, malformed/out-of-range/null predictions, offline data and failed provider responses never show a current percentage. Match13 additionally requires six distinct teams and the server's explicit TBA-six-team verification marker. A successful empty feed clears an old snapshot. Cross-event/team/config client snapshots never mix.

Tests cover normalized parsing, public provider identity, primary recovery, shared cache concurrency, 304s, 429/backoff, timeouts, bad responses, cache outages, source timestamps, invalid/mismatched lineups, all display gates, service-role permissions and desktop/phone UI. No test uses the user's API key.
