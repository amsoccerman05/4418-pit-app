import type { Context, Feed } from "./service";
// Keep last good data only within the same event, team and config revision.
// A successful empty/unpublished response clears old standings instead of
// making an earlier rank look current.
export function mergeFeed(previous: Feed | null, incoming: Feed): Feed {
  if (
    !previous ||
    previous.eventId !== incoming.eventId ||
    previous.eventKey !== incoming.eventKey ||
    previous.team !== incoming.team ||
    previous.configVersion !== incoming.configVersion
  )
    return incoming;
  return {
    ...incoming,
    ...(incoming.tbaError && !incoming.matches?.length
      ? { matches: previous.matches, tbaAt: previous.tbaAt }
      : {}),
    ...(incoming.standingsError && !incoming.standings && previous.standings
      ? {
          standings: previous.standings,
          standingsAt: previous.standingsAt,
          standingsStale: true,
        }
      : {}),
  };
}
export const isStale = (
  at: number | null | undefined,
  now: number,
  maxAge = 300000,
) => !at || now - at > maxAge || at > now + 60000;

export function feedMatchesConfig(
  feed: Feed | null,
  config: Context["config"],
): boolean {
  return (
    !!feed &&
    !!config &&
    feed.eventId === config.event_id &&
    feed.eventKey === config.tba_event_key &&
    feed.team === config.team_number &&
    feed.configVersion === config.version
  );
}
