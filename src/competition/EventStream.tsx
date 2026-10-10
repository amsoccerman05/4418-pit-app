import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  MAX_WEBCAST_ROWS,
  parseEventWebcasts,
  webcastEmbedUrl,
  webcastExternalUrl,
  type EventWebcast,
} from "../../supabase/functions/competition-feed/webcasts";
import "./event-stream.css";

export type EventStreamProps = {
  webcasts?: readonly EventWebcast[] | null;
  fetchedAt?: number | null;
  error?: string | null;
  stale?: boolean;
  online?: boolean;
  eventKey?: string | null;
};
type Choice = { eventKey: string; id: string } | null;
const provider = (stream: EventWebcast) =>
  stream.type === "youtube" ? "YouTube" : "Twitch";
const status = (stream: EventWebcast, stale: boolean) =>
  stream.status === "unknown"
    ? "Live status unknown"
    : `${stale ? "Last listed" : "Listed"} ${stream.status} by TBA`;

export function EventStream({
  webcasts,
  fetchedAt,
  error,
  stale = false,
  online = true,
  eventKey,
}: EventStreamProps) {
  const invalidListing =
    Array.isArray(webcasts) && webcasts.length > MAX_WEBCAST_ROWS;
  // Revalidate cached/client input too. No serialized id, href, embed URL, or
  // HTML from the feed can become a navigation target or iframe source.
  const streams = useMemo(
    () =>
      parseEventWebcasts(
        Array.isArray(webcasts) && !invalidListing
          ? webcasts.map((row) => ({ ...row, stream_title: row?.title }))
          : [],
      ),
    [webcasts, invalidListing],
  );
  const [choice, setChoice] = useState<Choice>(null);
  const [opened, setOpened] = useState<Choice>(null);
  const [hostname, setHostname] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const selectId = useId();
  const scope = eventKey || "";
  const selected =
    (choice?.eventKey === scope &&
      streams.find((stream) => stream.id === choice.id)) ||
    streams[0];
  const selectedId = selected?.id;
  const sourceStale = stale || !!error || invalidListing || !online;
  const embedSrc = useMemo(
    () =>
      selected
        ? webcastEmbedUrl(
            { type: selected.type, channel: selected.channel },
            hostname,
          )
        : null,
    [selected?.type, selected?.channel, hostname],
  );
  const tooNarrow = selected?.type === "twitch" && width < 400;
  const canOpen =
    !!scope &&
    !!selected &&
    !!embedSrc &&
    online &&
    selected.status !== "offline" &&
    !tooNarrow;
  const isOpen =
    canOpen && opened?.eventKey === scope && opened.id === selectedId;

  useEffect(() => {
    // Read the runtime hostname, never a feed field or configured site string.
    const host = window.location.hostname;
    setHostname(
      window.location.protocol === "https:" || host === "localhost"
        ? host
        : null,
    );
    const measure = () =>
      setWidth(
        Math.min(
          stage.current?.getBoundingClientRect().width || 0,
          window.innerWidth,
        ),
      );
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (stage.current) observer?.observe(stage.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Rendering is also guarded above, so a changed event/selection or offline
  // state removes the iframe immediately, before effects commit. Clearing the
  // opt-in prevents it from silently reopening when connectivity comes back.
  useEffect(() => {
    setOpened((previous) =>
      !canOpen || previous?.eventKey !== scope || previous?.id !== selectedId
        ? null
        : previous,
    );
  }, [scope, selectedId, canOpen]);

  const externalUrl = selected ? webcastExternalUrl(selected) : null;
  const checkedAt =
    typeof fetchedAt === "number" &&
    Number.isFinite(fetchedAt) &&
    fetchedAt > 0 &&
    !Number.isNaN(new Date(fetchedAt).getTime())
      ? new Date(fetchedAt)
      : null;

  return (
    <section className="card comp-event-stream" aria-label="Event stream">
      <div className="comp-stream-heading">
        <div>
          <h2>Event stream</h2>
          <p>
            Optional video. The webcast listing does not confirm it is live.
          </p>
        </div>
        {isOpen && (
          <button type="button" onClick={() => setOpened(null)}>
            Close stream
          </button>
        )}
      </div>
      <div className="comp-stream-metadata" role="status">
        {!online ? (
          <p>Offline · player closed. Saved stream links may be out of date.</p>
        ) : sourceStale ? (
          <p>
            Stream listing may be stale. Verify availability with the provider.
          </p>
        ) : null}
        <small>
          {checkedAt
            ? `TBA listing checked ${checkedAt.toLocaleString()}.`
            : "Stream listing has not been loaded."}
        </small>
      </div>
      {!scope ? (
        <p>Connect this event to TBA to see its listed streams.</p>
      ) : !streams.length ? (
        <p>
          {error || invalidListing
            ? "Stream listing unavailable. Other pit information is unaffected."
            : "No supported YouTube or Twitch stream is listed for this event."}
        </p>
      ) : (
        <>
          {streams.length > 1 && (
            <label htmlFor={selectId}>
              Choose stream
              <select
                id={selectId}
                value={selectedId}
                onChange={(event) => {
                  setOpened(null);
                  setChoice({ eventKey: scope, id: event.target.value });
                }}
              >
                {streams.map((stream, index) => (
                  <option key={stream.id} value={stream.id}>
                    {stream.title || `${provider(stream)} stream ${index + 1}`}{" "}
                    · {status(stream, sourceStale)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="comp-stream-details">
            <strong>
              {selected.title || `${provider(selected)} event stream`}
            </strong>
            <span>{status(selected, sourceStale)}</span>
            {selected.date && <span>Listed date: {selected.date}</span>}
          </div>
          <div className="comp-stream-actions">
            {!isOpen && (
              <button
                type="button"
                disabled={!canOpen}
                onClick={() => {
                  if (canOpen) setOpened({ eventKey: scope, id: selected.id });
                }}
              >
                Open stream
              </button>
            )}
            {externalUrl && (
              <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                Watch on {provider(selected)} (new tab)
              </a>
            )}
          </div>
          {selected.status === "offline" ? (
            <p>
              This stream is listed offline. Check the provider for updates.
            </p>
          ) : tooNarrow ? (
            <p>
              Twitch needs a player at least 400 pixels wide. Use the Twitch
              link on this screen.
            </p>
          ) : selected.type === "twitch" && !embedSrc ? (
            <p>
              Twitch embedding is unavailable on this host. Use the Twitch link.
            </p>
          ) : (
            <small>
              Opening the player connects to {provider(selected)}. Autoplay is
              off; press play in the player when ready.
            </small>
          )}
        </>
      )}
      <div className="comp-stream-stage" ref={stage}>
        {isOpen && selected && embedSrc && (
          <>
            <div className={`comp-stream-player comp-stream-${selected.type}`}>
              <iframe
                key={`${scope}:${selected.id}`}
                src={embedSrc}
                title={`${provider(selected)}: ${selected.title || "event stream"}`}
                allow="encrypted-media"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
            <small>
              Player blank, blocked, or unavailable? Use Watch on{" "}
              {provider(selected)} above. Video can lag behind the field;
              confirm match timing with the field crew.
            </small>
          </>
        )}
      </div>
    </section>
  );
}
