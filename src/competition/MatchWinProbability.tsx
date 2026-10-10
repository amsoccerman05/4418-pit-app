import type { Feed } from "./service";
import { isManualMatch, type OperationalMatch } from "./manual";
import { isStale } from "./feed-state";
import {
  selectMatchProbability,
  probabilityPercent,
} from "./match-probability";
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
  const probability = selectMatchProbability(
    feed,
    match,
    eventKey,
    now,
    unavailable,
  );
  const checked =
    probability?.fetchedAt ?? (sameEvent ? feed?.predictionsAt : null);
  const backup = probability?.provider === "Match13";
  const stale =
    !probability &&
    (unavailable || !!feed?.predictionsError || isStale(checked, now));
  return (
    <section
      className="comp-win-probability"
      aria-label="Match win probability"
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
            ? "Predictions aren’t available for manual practice matches."
            : stale
              ? "Prediction unavailable. Waiting for current prediction data and match schedule."
              : "No prediction for this match and lineup yet."}
        </p>
      )}
      <small>
        <a
          href={
            backup ? "https://www.match13.com/" : "https://www.statbotics.io/"
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          {backup ? "Match13 backup" : "Statbotics"}
        </a>
        {!manual && checked
          ? ` · Fetched ${new Date(checked).toLocaleString()}${stale ? " · Stale or unavailable" : ""}`
          : ""}
      </small>
      {probability && (
        <small className="comp-win-note">
          Pre-match model estimate, not a guarantee. No separate tie estimate.
          {backup
            ? " Red/blue from the matching TBA lineup; Match13’s alliance colors cannot be independently verified."
            : ""}
        </small>
      )}
    </section>
  );
}
