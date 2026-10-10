import { createCache } from "./cache.ts";
import { parseEventWebcasts, type EventWebcast } from "./webcasts.ts";
import {
  parseMatchPredictions,
  type MatchPrediction,
  parseTeamEPAs,
  type TeamEPA,
} from "./statbotics.ts";
import {
  parseNexusBoard,
  parsePitAddresses,
  parsePitMap,
  type NexusBoard,
  type PitAddresses,
  type PitMap,
} from "./nexus-board.ts";
type ResponseData = {
  data: unknown;
  at: number | null;
  error: string | null;
  notFound?: boolean;
};
type Snapshot<T> = { data: T | null; at: number | null; error: string | null };
// Separate validated snapshots prevent malformed HTTP 200s acquiring a fresh
// display time. Nothing from these public APIs is written into team records.
export function createDisplayFeed(
  cached: ReturnType<typeof createCache> = createCache(),
) {
  const snapshots = new Map<string, { data: unknown; at: number }>();
  async function validated<T>(
    id: string,
    request: Promise<ResponseData>,
    parse: (data: unknown, response: ResponseData) => T,
    label: string,
    isCurrent?: (data: T, previous: T) => boolean,
  ): Promise<Snapshot<T>> {
    const previous = snapshots.get(id);
    try {
      const response = await request;
      if (
        response.error ||
        !Number.isSafeInteger(response.at) ||
        !response.at ||
        response.at <= 0
      )
        throw new Error("Unavailable");
      const data = parse(response.data, response);
      if (previous && isCurrent && !isCurrent(data, previous.data as T))
        throw new Error("Older source snapshot");
      snapshots.set(id, { data, at: response.at });
      if (snapshots.size > 128)
        snapshots.delete(snapshots.keys().next().value!);
      return { data, at: response.at, error: null };
    } catch {
      return {
        data: (previous?.data as T) ?? null,
        at: previous?.at ?? null,
        error: `${label} unavailable; last loaded data may be stale`,
      };
    }
  }
  return async function getDisplayFeed(
    event: string,
    nexusEvent: string | null,
    tbaKey: string | undefined,
    nexusKey: string | undefined,
    live: Promise<ResponseData>,
  ) {
    if (!/^[0-9]{4}[a-z0-9]{1,40}$/.test(event))
      throw new Error("Invalid event configuration");
    const hasNexus = !!nexusEvent && /^[a-zA-Z0-9_-]{1,80}$/.test(nexusEvent);
    const absent = Promise.resolve({
      data: null,
      at: null,
      error: "Nexus not configured",
    });
    const nexusBase = `https://frc.nexus/api/v1/event/${encodeURIComponent(nexusEvent || "")}`;
    const [info, epa, predictions, board, map, addresses] = await Promise.all([
      validated<{ name: string | null; webcasts: EventWebcast[] }>(
        `event:${event}`,
        cached(
          `https://www.thebluealliance.com/api/v3/event/${event}`,
          "X-TBA-Auth-Key",
          tbaKey,
          300000,
        ),
        (raw) => {
          const r = raw as Record<string, unknown> | null;
          if (!r || r.key !== event || !Array.isArray(r.webcasts))
            throw new Error("Invalid event metadata");
          return {
            name: typeof r.name === "string" ? r.name.slice(0, 200) : null,
            webcasts: parseEventWebcasts(r.webcasts),
          };
        },
        "TBA event streams",
      ),
      validated<TeamEPA[]>(
        `epa:${event}`,
        cached(
          `https://api.statbotics.io/v3/team_events?event=${event}&limit=1000`,
          null,
          undefined,
          300000,
        ),
        (raw) => parseTeamEPAs(raw, event),
        "Statbotics event EPA",
      ),
      validated<MatchPrediction[]>(
        `predictions:${event}`,
        cached(
          `https://api.statbotics.io/v3/matches?event=${event}&limit=1000`,
          null,
          undefined,
          60000,
        ),
        (raw) => parseMatchPredictions(raw, event),
        "Statbotics match predictions",
      ),
      validated<NexusBoard>(
        `board:${nexusEvent}`,
        hasNexus ? live : absent,
        (raw, response) => {
          const board = parseNexusBoard(raw, nexusEvent!);
          if (board.asOf > response.at! + 60000)
            throw new Error("Future source time");
          return board;
        },
        "Nexus event board",
        (data, previous) => data.asOf >= previous.asOf,
      ),
      validated<PitMap | null>(
        `map:${nexusEvent}`,
        hasNexus
          ? cached(`${nexusBase}/map`, "Nexus-Api-Key", nexusKey, 300000, {
              notFoundIsEmpty: true,
            })
          : absent,
        (raw, response) => {
          if (raw === null && !response.notFound)
            throw new Error("Invalid map response");
          return parsePitMap(raw);
        },
        "Nexus pit map",
      ),
      validated<PitAddresses>(
        `pits:${nexusEvent}`,
        hasNexus
          ? cached(`${nexusBase}/pits`, "Nexus-Api-Key", nexusKey, 300000)
          : absent,
        parsePitAddresses,
        "Nexus pit addresses",
      ),
    ]);
    return {
      eventName: info.data?.name ?? null,
      webcasts: info.data?.webcasts ?? [],
      webcastsAt: info.at,
      webcastsError: info.error,
      teamEPAs: epa.data ?? [],
      epaAt: epa.at,
      epaError: epa.error,
      matchPredictions: predictions.data ?? [],
      predictionsAt: predictions.at,
      predictionsError: predictions.error,
      nexusBoard: board.data,
      nexusBoardAt: board.at,
      nexusBoardError: board.error,
      pitMap: map.data,
      pitMapAt: map.at,
      pitMapError: map.error,
      pitAddresses: addresses.data,
      pitAddressesAt: addresses.at,
      pitAddressesError: addresses.error,
    };
  };
}
