import type { Competition } from "./service";
import { isStale } from "./feed-state";
export function EventStandings({ c, team }: { c: Competition; team: number }) {
  const feed = c.feed,
    standings = feed?.standings;
  const hasData =
    !!standings && (standings.rank !== null || standings.record !== null);
  const stale = !!(
    c.feedError ||
    feed?.standingsError ||
    feed?.standingsStale ||
    isStale(feed?.standingsAt, c.tick)
  );
  return (
    <section
      className="card comp-standings"
      aria-label={`Team ${team} event standings`}
    >
      <h2>Team {team} · Event standings</h2>
      <div className="comp-standings-values">
        <div>
          <small>QUALIFICATION RANK</small>
          <strong>
            {standings?.rank != null ? `#${standings.rank}` : "Not available"}
          </strong>
          {standings?.rank != null && standings.numTeams != null && (
            <span>of {standings.numTeams} teams</span>
          )}
        </div>
        <div>
          <small>QUALIFICATION RECORD · W–L–T</small>
          <strong>
            {standings?.record
              ? `${standings.record.wins}–${standings.record.losses}–${standings.record.ties}`
              : "Not available"}
          </strong>
        </div>
      </div>
      <p className={stale && hasData ? "comp-stale" : ""}>
        {hasData
          ? stale
            ? "Last known standings · may be stale"
            : "Current event qualification standings"
          : !feed && !c.feedError && !c.error
            ? "Loading standings…"
            : "Standings not published or unavailable."}
      </p>
      <small>
        Qualification matches only; playoff results are separate.{" "}
        {feed?.standingsAt
          ? `TBA checked ${new Date(feed.standingsAt).toLocaleString()}.`
          : ""}{" "}
        {feed?.eventKey && (
          <a
            href={`https://www.thebluealliance.com/event/${encodeURIComponent(feed.eventKey)}`}
            target="_blank"
            rel="noreferrer"
          >
            View event on TBA
          </a>
        )}
      </small>
    </section>
  );
}
