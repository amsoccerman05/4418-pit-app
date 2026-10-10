import { useId, useRef, useState } from "react";
import {
  findTeamPit,
  type NexusBoard,
  type PitAddresses,
  type PitArrow,
  type PitMap,
  type PitShape,
} from "../../supabase/functions/competition-feed/nexus-board";
import "./event-board.css";

export type EventBoardProps = {
  board: NexusBoard | null;
  boardAt?: number | null;
  boardError?: string | null;
  boardStale?: boolean;
  map: PitMap | null;
  mapAt?: number | null;
  mapError?: string | null;
  mapStale?: boolean;
  addresses?: PitAddresses | null;
  addressesAt?: number | null;
  addressesError?: string | null;
  addressesStale?: boolean;
  now?: number;
  team?: number;
};
const stamp = (at?: number | null) =>
  at && Number.isFinite(at) ? new Date(at).toLocaleString() : "Not checked";
const transform = (shape: PitShape) =>
  `translate(${shape.x} ${shape.y}) rotate(${shape.angle})`;
const aged = (at: number | null | undefined, now: number, maxAge: number) =>
  !at || now - at > maxAge || at > now + 60000;
function Arrow({ arrow }: { arrow: PitArrow }) {
  const w = arrow.width / 2,
    h = arrow.height / 2;
  const points =
    arrow.type === "single"
      ? `0,${-h} ${w},0 ${w / 3},0 ${w / 3},${h} ${-w / 3},${h} ${-w / 3},0 ${-w},0`
      : `0,${-h} ${w},${-h / 3} ${w / 3},${-h / 3} ${w / 3},${h / 3} ${w},${h / 3} 0,${h} ${-w},${h / 3} ${-w / 3},${h / 3} ${-w / 3},${-h / 3} ${-w},${-h / 3}`;
  return (
    <polygon
      transform={transform(arrow)}
      points={points}
      className={`event-map-arrow event-map-arrow-${arrow.color}`}
    />
  );
}

/** Read-only, inline expansion keeps operational readiness visible above it. */
export function EventBoard({
  board,
  boardAt,
  boardError,
  boardStale,
  map,
  mapAt,
  mapError,
  mapStale,
  addresses,
  addressesAt,
  addressesError,
  addressesStale,
  now = Date.now(),
  team,
}: EventBoardProps) {
  const id = useId();
  const mapToggle = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [allAnnouncements, setAllAnnouncements] = useState(false);
  const [allRequests, setAllRequests] = useState(false);
  const [query, setQuery] = useState(team ? String(team) : "");
  const [selected, setSelected] = useState(team ? String(team) : "");
  const boardOld = !!(
    board &&
    (boardStale || boardError || aged(board.asOf, now, 120000))
  );
  const mapOld = !!(map && (mapStale || mapError || aged(mapAt, now, 600000)));
  const addressesOld = !!(
    addresses &&
    (addressesStale || addressesError || aged(addressesAt, now, 600000))
  );
  const selectedPit = findTeamPit(selected, map, addresses);
  const address = addresses?.[selected] ?? selectedPit?.id;
  const announcements =
    board?.announcements.slice(0, allAnnouncements ? 10 : 3) ?? [];
  const requests = board?.partsRequests.slice(0, allRequests ? 20 : 4) ?? [];
  const selectTeam = (value: string) => {
    setSelected(value);
    setQuery(value);
    setExpanded(true);
  };
  const closeMap = () => {
    setExpanded(false);
    setSelected("");
    setQuery("");
    mapToggle.current?.focus();
  };
  return (
    <section className="event-board" aria-labelledby={`${id}-title`}>
      <header className="event-board-heading">
        <div>
          <small>FROM THE EVENT</small>
          <h2 id={`${id}-title`}>Event board</h2>
        </div>
        <a href="https://frc.nexus" target="_blank" rel="noreferrer">
          Data by Nexus
        </a>
      </header>
      <div
        className={`event-board-source${boardOld ? " event-board-warning" : ""}`}
      >
        {board ? (
          <>
            <strong>
              {boardOld
                ? "Last known board · may be stale"
                : "Latest event snapshot"}
            </strong>
            <span>
              Published {stamp(board.asOf)}
              {boardAt ? ` · Checked ${stamp(boardAt)}` : ""}
            </span>
            {boardError && (
              <span>
                Board refresh unavailable. Confirm requests with the team.
              </span>
            )}
          </>
        ) : (
          <p>
            {boardError
              ? "Event board unavailable. Announcements and requests could not be checked."
              : "Event board not available yet."}
          </p>
        )}
      </div>
      <div className="event-board-columns">
        <section aria-labelledby={`${id}-announcements`}>
          <h3 id={`${id}-announcements`}>
            Announcements
            {board ? (
              <span className="event-board-count">
                {board.announcementCount}
              </span>
            ) : null}
          </h3>
          {board && !announcements.length && (
            <p className="event-board-empty">
              {boardOld
                ? "No announcements in the last known snapshot."
                : "No current announcements."}
            </p>
          )}
          {!board && <p className="event-board-empty">Not available</p>}
          <ol className="event-board-posts">
            {announcements.map((item) => (
              <li key={item.id}>
                <p tabIndex={item.text.length > 400 ? 0 : undefined}>
                  {item.text}
                </p>
                <time dateTime={new Date(item.at).toISOString()}>
                  {stamp(item.at)}
                </time>
              </li>
            ))}
          </ol>
          {!!board && board.announcements.length > 3 && (
            <button
              type="button"
              className="event-board-text-button"
              aria-expanded={allAnnouncements}
              onClick={() => setAllAnnouncements(!allAnnouncements)}
            >
              {allAnnouncements
                ? "Show fewer announcements"
                : `Show latest ${board.announcements.length} announcements`}
            </button>
          )}
          {!!board && board.announcementCount > board.announcements.length && (
            <small>
              Showing up to the latest {board.announcements.length} of{" "}
              {board.announcementCount} announcements.
            </small>
          )}
        </section>
        <section aria-labelledby={`${id}-requests`}>
          <h3 id={`${id}-requests`}>
            Parts requests
            {board ? (
              <span className="event-board-count">
                {board.partsRequestCount}
              </span>
            ) : null}
          </h3>
          {board && !requests.length && (
            <p className="event-board-empty">
              {boardOld
                ? "No requests in the last known snapshot."
                : "No current parts requests."}
            </p>
          )}
          {!board && <p className="event-board-empty">Not available</p>}
          <ol className="event-board-posts">
            {requests.map((item) => {
              const pit = findTeamPit(item.team, map, addresses);
              const textAddress = addresses?.[item.team] ?? pit?.id;
              return (
                <li key={item.id}>
                  <div className="event-board-request-team">
                    {pit ? (
                      <button
                        type="button"
                        className="event-board-team"
                        onClick={() => selectTeam(item.team)}
                        aria-label={`Find team ${item.team} at pit ${pit.id}`}
                      >
                        Team {item.team} ↗
                      </button>
                    ) : (
                      <strong>Team {item.team}</strong>
                    )}
                    <span>
                      {textAddress
                        ? `Pit ${textAddress}${mapOld || addressesOld ? " · last known" : ""}`
                        : "Pit address not published"}
                    </span>
                  </div>
                  <p tabIndex={item.text.length > 400 ? 0 : undefined}>
                    {item.text}
                  </p>
                  <time dateTime={new Date(item.at).toISOString()}>
                    {stamp(item.at)}
                  </time>
                </li>
              );
            })}
          </ol>
          {!!board && board.partsRequests.length > 4 && (
            <button
              type="button"
              className="event-board-text-button"
              aria-expanded={allRequests}
              onClick={() => setAllRequests(!allRequests)}
            >
              {allRequests
                ? "Show fewer requests"
                : `Show latest ${board.partsRequests.length} requests`}
            </button>
          )}
          {!!board && board.partsRequestCount > board.partsRequests.length && (
            <small>
              Showing up to the latest {board.partsRequests.length} of{" "}
              {board.partsRequestCount} requests.
            </small>
          )}
          {requests.length > 0 && (
            <small>
              Currently posted in Nexus; availability may have changed. Ask the
              requesting team directly.
            </small>
          )}
        </section>
      </div>
      <section className="event-board-pits" aria-labelledby={`${id}-pits`}>
        <div className="event-board-map-heading">
          <h3 id={`${id}-pits`}>Find a pit</h3>
          <button
            type="button"
            className="event-board-toggle"
            ref={mapToggle}
            aria-expanded={expanded}
            aria-controls={`${id}-map`}
            onClick={() => (expanded ? closeMap() : setExpanded(true))}
          >
            {expanded ? "Close pit map" : "Open pit map"}
          </button>
        </div>
        <p className="event-board-map-status">
          {map
            ? `${mapOld ? "Last known map · may be stale" : "Pit map available"} · Checked ${stamp(mapAt)}`
            : mapError
              ? "Pit map unavailable. The map could not be checked."
              : mapAt
                ? "No pit map published for this event."
                : "Pit map not available yet."}
        </p>
        {expanded && (
          <div
            id={`${id}-map`}
            className="event-board-map-content"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeMap();
              }
            }}
          >
            <form
              className="event-board-lookup"
              onSubmit={(event) => {
                event.preventDefault();
                setSelected(query.trim());
              }}
            >
              <label htmlFor={`${id}-team`}>Team number</label>
              <div>
                <input
                  id={`${id}-team`}
                  inputMode="numeric"
                  pattern="[1-9][0-9]{0,4}"
                  maxLength={5}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="e.g. 4418"
                  required
                />
                <button type="submit">Find pit</button>
                {(query || selected) && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setSelected("");
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </form>
            <p className="event-board-selection" role="status">
              {selected ? (
                !/^[1-9]\d{0,4}$/.test(selected) ? (
                  "Enter a valid team number."
                ) : selectedPit ? (
                  <>
                    Team <strong>{selected}</strong> · Pit{" "}
                    <strong>{selectedPit.id}</strong> is highlighted.
                    {mapOld || addressesOld
                      ? " Last known location; verify at the venue."
                      : ""}
                  </>
                ) : address ? (
                  <>
                    Team <strong>{selected}</strong> · Pit{" "}
                    <strong>{address}</strong>. No unambiguous map location is
                    available.
                  </>
                ) : (
                  <>
                    No pit location is published for team{" "}
                    <strong>{selected}</strong>.
                  </>
                )
              ) : (
                "Enter a team number or select a labeled pit."
              )}
            </p>
            {!!addressesAt && (
              <p
                className={`event-board-address-status${addressesOld ? " event-board-warning" : ""}`}
              >
                Pit addresses {addressesOld ? "may be stale · " : ""}checked{" "}
                {stamp(addressesAt)}
              </p>
            )}
            {addressesError && (
              <p className="event-board-warning">
                Pit address refresh unavailable; mapped assignments may still be
                shown.
              </p>
            )}
            {map && (
              <div className="event-board-map-scroll">
                <svg
                  viewBox={`0 0 ${map.width} ${map.height}`}
                  role="group"
                  aria-label="Event pit map. Use team lookup for a text address."
                  className="event-board-map"
                >
                  <title>Event pit map</title>
                  <rect
                    width={map.width}
                    height={map.height}
                    className="event-map-background"
                  />
                  {map.walls.map((shape) => (
                    <rect
                      key={shape.id}
                      transform={transform(shape)}
                      x={-shape.width / 2}
                      y={-shape.height / 2}
                      width={shape.width}
                      height={shape.height}
                      className="event-map-wall"
                    />
                  ))}
                  {map.areas.map((shape) => (
                    <g key={shape.id} transform={transform(shape)}>
                      <rect
                        x={-shape.width / 2}
                        y={-shape.height / 2}
                        width={shape.width}
                        height={shape.height}
                        className="event-map-area"
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={Math.max(
                          1,
                          Math.min(
                            shape.height / 4,
                            shape.width / Math.max(shape.label.length * 0.6, 1),
                          ),
                        )}
                        className="event-map-label"
                      >
                        {shape.label}
                      </text>
                    </g>
                  ))}
                  {map.arrows.map((arrow) => (
                    <Arrow key={arrow.id} arrow={arrow} />
                  ))}
                  {map.pits.map((pit) => {
                    const team =
                      pit.team ??
                      Object.keys(addresses ?? {}).find(
                        (candidate) => addresses?.[candidate] === pit.id,
                      );
                    const canSelect =
                      !!team &&
                      findTeamPit(team, map, addresses)?.id === pit.id;
                    return (
                      <g
                        key={pit.id}
                        transform={transform(pit)}
                        className={`event-map-pit${selectedPit?.id === pit.id ? " event-map-selected" : ""}`}
                        role={canSelect ? "button" : undefined}
                        tabIndex={canSelect ? 0 : undefined}
                        aria-label={
                          team
                            ? `Team ${team}, pit ${pit.id}${canSelect ? "" : ", assignment uncertain"}`
                            : `Pit ${pit.id}, unassigned`
                        }
                        aria-pressed={
                          canSelect ? selectedPit?.id === pit.id : undefined
                        }
                        onClick={canSelect ? () => selectTeam(team) : undefined}
                        onKeyDown={
                          canSelect
                            ? (event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  selectTeam(team);
                                }
                              }
                            : undefined
                        }
                      >
                        <title>
                          {team
                            ? `Team ${team} · Pit ${pit.id}`
                            : `Pit ${pit.id} · Unassigned`}
                        </title>
                        <rect
                          x={-pit.width / 2}
                          y={-pit.height / 2}
                          width={pit.width}
                          height={pit.height}
                          rx={Math.min(pit.width, pit.height) * 0.05}
                        />
                        <text
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={Math.max(
                            0.1,
                            Math.min(
                              pit.height / 4,
                              pit.width /
                                Math.max((team ?? pit.id).length * 0.7, 1),
                            ),
                          )}
                        >
                          {team ?? pit.id}
                        </text>
                      </g>
                    );
                  })}
                  {map.labels.map((shape) => (
                    <text
                      key={shape.id}
                      transform={transform(shape)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={Math.max(
                        1,
                        Math.min(
                          shape.height / 3,
                          shape.width / Math.max(shape.label.length * 0.6, 1),
                        ),
                      )}
                      className="event-map-label"
                    >
                      {shape.label}
                    </text>
                  ))}
                </svg>
              </div>
            )}
            {map && (
              <small>
                Highlight uses exact published team assignments. Map placement
                is approximate; follow venue signs.
              </small>
            )}
          </div>
        )}
      </section>
    </section>
  );
}
