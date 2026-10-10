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
    // The two views share one TBA snapshot. Retain them together only when
    // the failed response has no usable schedule; never mix timestamps/views.
    ...(incoming.tbaError &&
    !incoming.matches?.length &&
    !incoming.scoutingMatches?.length
      ? {
          matches: previous.matches,
          scoutingMatches: previous.scoutingMatches,
          tbaAt: previous.tbaAt,
        }
      : {}),
    ...(incoming.teamsError && !incoming.eventTeams?.length
      ? { eventTeams: previous.eventTeams, teamsAt: previous.teamsAt }
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
