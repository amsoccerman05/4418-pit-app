# Live pit display

The fullscreen Pit display adds an always-visible queue/readiness strip, a large text-and-color bumper indicator, optional event video, a read-only event board and pit map, and six-team Statbotics comparison. Existing 4418 match operations, manual practices, battery identity, checklist requirements and private scouting records are unchanged.

## Reading the display

- The queue timer uses Nexus's **estimated** queue time. `Now queuing`, `On deck`, `On field`, and actual queue timestamps take precedence. An expired estimate says to confirm with the field crew; it never counts below zero or invents a live state. After either Nexus source or fetch time is over two minutes old, the timer stops and says live queue unavailable.
- The event-delay line is the last measured difference between a published TBA scheduled start and actual start. It identifies the match and timestamp. It is not a forecast for the next match.
- Readiness remains visible above video and maps. Manual practices keep their independent workflow and do not acquire an official bumper color or queue countdown.
- Announcements and parts requests are currently posted Nexus items. The display does not post, fulfill or respond to requests. Team links highlight a pit only when assignment is exact and unambiguous. No map/addresses, missing service, and stale data have distinct labels.
- **Open stream** loads only a validated YouTube or Twitch identifier listed by TBA. A listing is not proof a stream is live. Autoplay and fullscreen are disabled; muted playback starts only through the provider's player. Close, change stream, change event, or go offline to unload it. Twitch uses an external link on narrow screens or unsupported hosts. The external provider link remains available when an embedded player is blocked.
- Scouting → Compare offers **Compare next 4418 match** and a scheduled-match selector. EPA is presented next to the existing synced firsthand observation table. Unknown EPA stays unavailable; a real zero remains 0.0. EPA estimates scoring contribution and is not a match prediction. No private scouting observations are sent to Statbotics.

## Sources and boundaries

The existing authenticated `competition-feed` function uses existing TBA/Nexus secrets on their fixed HTTPS hosts. The TBA full-event endpoint supplies webcast metadata; the existing event match feed still provides all-event scouting and a 4418-only operations projection. Nexus event status, `/pits`, and `/map` provide the event board. A map HTTP 404 is a valid no-map result; malformed HTTP 200 data retains the last validated snapshot and original time. Statbotics's public `/v3/team_events?event=…&limit=1000` needs no credential and receives only the public event key. Lists over the supported page size fail explicitly instead of silently truncating.

Queue reads are cached for 30 seconds; matches/standings for one minute; webcast listings, maps, addresses and EPA for five minutes, with shared in-flight requests and ETags. Failed or invalid reads keep explicit error labels and previous timestamps. Event/config/account changes clear scoped browser data. Optional service failures do not change robot readiness or enable writes.

No database migration, credential creation, auth grant, posting API, or production test data is needed. The app's CSP allows frames only from `www.youtube-nocookie.com` and `player.twitch.tv`; arbitrary iframe HTML and provider URLs are rejected. Opening video connects the browser to that provider. Nexus data is attributed with a link to [Nexus](https://frc.nexus).

Official contracts checked October 10, 2026:
- [Nexus API v1.8](https://frc.nexus/api/v1/docs)
- [TBA OpenAPI](https://www.thebluealliance.com/swagger/api_v3.json)
- [Statbotics v3 OpenAPI](https://api.statbotics.io/openapi.json)
- [Statbotics official team-event model](https://github.com/avgupta456/statbotics/blob/master/backend/src/db/models/team_event.py)
- [YouTube player parameters](https://developers.google.com/youtube/player_parameters)
- [Twitch embedding requirements](https://dev.twitch.tv/docs/embed/video-and-clips/)

## Verification and rollout

Run `npm run build`, `npm test`, and `npm run test:e2e`. The new tests cover actual/estimated/expired/stale queue timing; bounded hostile metadata; public-only upstream requests; no-map versus malformed-map provenance; EPA missing versus zero; video opt-in, selection and connectivity changes; map keyboard/close flows; and desktop/phone layout. Browser fixtures intercept video and never contact team production data or play actual media.

Deploy all `supabase/functions/competition-feed/*.ts` files together, preserving the existing function's custom authentication configuration, then deploy the tested frontend. New frontend fields are optional for a safe staggered rollout. No migration is required. Verify the exact deployed asset hashes and inspect an authenticated display without modifying production records. Actual webcast playback remains dependent on the event listing, provider embedding permissions and network connectivity.
