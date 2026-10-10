import type { Feed } from "./service";
import { isStale } from "./feed-state";
export function StatboticsComparison({
  feed,
  teams,
  now,
  unavailable = false,
}: {
  feed: Feed | null;
  teams: number[];
  now: number;
  unavailable?: boolean;
}) {
  const stale =
    unavailable || !!feed?.epaError || isStale(feed?.epaAt, now, 600000);
  const selected = [...new Set(teams)]
    .filter((n) => Number.isSafeInteger(n) && n > 0 && n <= 99999)
    .slice(0, 6);
  const fmt = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) ? n.toFixed(1) : "Unavailable";
  return (
    <section className="card comp-epa" aria-label="Statbotics comparison">
      <h3>Statbotics event EPA</h3>
      <p>
        Estimated scoring contribution in points. Use alongside our firsthand
        scouting; this is not an official score or a match prediction.
      </p>
      <small className={stale ? "comp-stale" : ""}>
        {stale ? "Unavailable or stale · " : ""}
        {feed?.epaAt
          ? `Last checked ${new Date(feed.epaAt).toLocaleString()}`
          : "Not loaded"}{" "}
        ·{" "}
        <a
          href="https://www.statbotics.io/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Statbotics
        </a>
      </small>
      {selected.length ? (
        <div className="comp-epa-grid">
          {selected.map((team) => {
            const epa = feed?.teamEPAs?.find((row) => row.team === team);
            return (
              <article key={team}>
                <strong>Team {team}</strong>
                <span className="comp-epa-total">{fmt(epa?.total)}</span>
                <small>Total EPA</small>
                <dl>
                  <div>
                    <dt>AUTO</dt>
                    <dd>{fmt(epa?.auto)}</dd>
                  </div>
                  <div>
                    <dt>TELEOP</dt>
                    <dd>{fmt(epa?.teleop)}</dd>
                  </div>
                  <div>
                    <dt>Endgame</dt>
                    <dd>{fmt(epa?.endgame)}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      ) : (
        <p>Select up to six teams to compare.</p>
      )}
    </section>
  );
}
