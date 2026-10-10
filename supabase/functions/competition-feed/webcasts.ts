// TBA Event.webcasts is a directory, not a live-presence API. Accept only the
// documented provider/channel fields; never preserve upstream URLs or HTML.
export type EventWebcast = {
  id: string;
  type: "youtube" | "twitch";
  channel: string;
  status: "online" | "offline" | "unknown";
  title: string | null;
  date: string | null;
};

export const MAX_WEBCAST_ROWS = 100;
export const MAX_EVENT_WEBCASTS = 20;

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) =>
  typeof v === "string"
    ? v
        .slice(0, 800)
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200)
        .trim() || null
    : null;
const date = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const time = Date.parse(`${v}T00:00:00.000Z`);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === v
    ? v
    : null;
};

function identity(type: unknown, value: unknown) {
  if (typeof value !== "string") return null;
  // Deliberately accept identifiers only, not even provider-owned URLs. TBA
  // supplies a YouTube video ID or Twitch channel, not arbitrary embed markup.
  if (type === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(value))
    return { type, channel: value } as const;
  if (type === "twitch" && /^[A-Za-z0-9_]{1,25}$/.test(value))
    return { type, channel: value.toLowerCase() } as const;
  return null;
}

export function parseEventWebcasts(raw: unknown): EventWebcast[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_WEBCAST_ROWS)
    throw new Error("Invalid TBA webcast response");
  const streams = new Map<string, EventWebcast>();
  for (const row of raw) {
    if (!object(row)) continue;
    const known = identity(row.type, row.channel);
    if (!known) continue;
    const id = `${known.type}:${known.channel}`;
    const item: EventWebcast = {
      id,
      ...known,
      status:
        row.status === "online" || row.status === "offline"
          ? row.status
          : "unknown",
      title: text(row.stream_title),
      date: date(row.date),
    };
    const previous = streams.get(id);
    if (previous) {
      // Conflicting duplicate presence/date metadata must not manufacture a
      // current live claim. A missing status also remains explicitly unknown.
      previous.status =
        previous.status === item.status ? previous.status : "unknown";
      previous.date = previous.date === item.date ? previous.date : null;
      previous.title ??= item.title;
    } else streams.set(id, item);
  }
  return [...streams.values()].slice(0, MAX_EVENT_WEBCASTS);
}

type StreamIdentity = Pick<EventWebcast, "type" | "channel">;

export function webcastExternalUrl(stream: StreamIdentity): string | null {
  const known = stream && identity(stream.type, stream.channel);
  if (!known) return null;
  return known.type === "youtube"
    ? `https://www.youtube.com/watch?v=${known.channel}`
    : `https://www.twitch.tv/${known.channel}`;
}

export function validEmbedHostname(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 253) return false;
  if (value === "localhost") return true;
  const labels = value.split(".");
  if (
    labels.length < 2 ||
    !labels.every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
    )
  )
    return false;
  return /^\d+(?:\.\d+){3}$/.test(value)
    ? labels.every((label) => Number(label) <= 255)
    : !/^\d+$/.test(labels[labels.length - 1]);
}

export function webcastEmbedUrl(
  stream: StreamIdentity,
  hostname: unknown,
): string | null {
  const known = stream && identity(stream.type, stream.channel);
  if (!known) return null;
  if (known.type === "youtube") {
    // Privacy-enhanced host: support.google.com/youtube/answer/171780
    // Controls/inline/autoplay: developers.google.com/youtube/player_parameters
    return `https://www.youtube-nocookie.com/embed/${known.channel}?autoplay=0&controls=1&playsinline=1&mute=1&fs=0`;
  }
  if (!validEmbedHostname(hostname)) return null;
  // Non-interactive iframe, no provider SDK; Twitch requires the actual parent.
  // dev.twitch.tv/docs/embed/video-and-clips/
  const query = new URLSearchParams({
    channel: known.channel,
    parent: hostname,
    autoplay: "false",
    muted: "true",
  });
  return `https://player.twitch.tv/?${query}`;
}
