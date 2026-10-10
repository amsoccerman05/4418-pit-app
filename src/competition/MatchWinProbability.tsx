import type { Feed } from "./service";
import { isManualMatch, type OperationalMatch } from "./manual";
import { isStale } from "./feed-state";
import { matchProbability, probabilityPercent } from "./match-probability";
import "./match-probability.css";

export function MatchWinProbability({
  feed,
  match,
  eventKey,
  now,
  unavailable = false,
}: {
  feed: Feed | null;
  match: OperationalMatch;
  eventKey: string | undefined;
  now: number;
  unavailable?: boolean;
}) {
  const manual = isManualMatch(match);
  const sameEvent = !!eventKey && feed?.eventKey === eventKey;
  const checked = sameEvent ? feed?.predictionsAt : null;
  const probability = matchProbability(feed, match, eventKey, now, unavailable);
  const stale =
    unavailable || !!feed?.predictionsError || isStale(checked, now);
  return (
    <section
      className="comp-win-probability"
      aria-label="Statbotics match probability"
    >
      <h3>Estimated win chance · {match.label}</h3>
      {probability && !manual ? (
        <div className="comp-win-alliances">
          {(["red", "blue"] as const).map((color) => (
            <div key={color} className={`comp-win-alliance comp-win-${color}`}>
              <span>
                {color === "red" ? "Red" : "Blue"} alliance
                {match.alliance === color ? ` · Team ${feed?.team}` : ""}
              </span>
              <strong>{probabilityPercent(probability[color])}</strong>
              <small>{match[color].join(" · ")}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="comp-win-unavailable">
          {manual
            ? "Statbotics predictions aren’t available for manual practice matches."
            : stale
              ? "Prediction unavailable. Waiting for current Statbotics data and match schedule."
              : "No Statbotics prediction for this match and lineup yet."}
        </p>
      )}
      <small>
        <a
          href="https://www.statbotics.io/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Statbotics
        </a>
        {!manual && checked
          ? ` · Last checked ${new Date(checked).toLocaleString()}${stale ? " · Stale or unavailable" : ""}`
          : ""}
      </small>
      {probability && (
        <small className="comp-win-note">
          Pre-match model estimate, not a guarantee. No separate tie estimate.
        </small>
      )}
    </section>
  );
}
