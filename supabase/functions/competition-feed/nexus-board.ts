// Nexus API v1.8.0: https://frc.nexus/api/v1/docs (verified 2026-10-10).
// These are display-only projections, never upstream HTML, URLs, SVG or credentials.
export type NexusAnnouncement = { id: string; text: string; at: number };
export type NexusPartsRequest = NexusAnnouncement & { team: string };
export type NexusBoard = {
  asOf: number;
  announcements: NexusAnnouncement[];
  partsRequests: NexusPartsRequest[];
  announcementCount: number;
  partsRequestCount: number;
};
export type PitAddresses = Record<string, string>;
export type PitShape = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
};
export type MappedPit = PitShape & { team: string | null };
export type PitLabel = PitShape & { label: string };
export type PitArrow = PitShape & {
  type: "single" | "double";
  color: "red" | "blue" | "purple" | "gray";
};
export type PitMap = {
  width: number;
  height: number;
  pits: MappedPit[];
  areas: PitLabel[];
  labels: PitLabel[];
  arrows: PitArrow[];
  walls: PitShape[];
};
export const NEXUS_BOARD_LIMITS = {
  announcements: 10,
  partsRequests: 20,
  inputPosts: 1000,
  text: 3000,
  addresses: 1000,
  pits: 800,
  decorations: 200,
  elements: 1400,
  dimension: 100000,
} as const;

const invalid = (kind: string): never => {
  throw new Error(`Invalid Nexus ${kind} response`);
};
const object = (value: unknown, kind: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid(kind);
  return value as Record<string, unknown>;
};
const cleanText = (
  value: unknown,
  max: number,
  kind: string,
  truncate = false,
): string => {
  if (typeof value !== "string" || value.length > (truncate ? 20000 : max))
    return invalid(kind);
  const text = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .trim();
  if (!text || (!truncate && text !== value)) return invalid(kind);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const teamNumber = (value: unknown, kind: string): string => {
  if (typeof value !== "string" || !/^[1-9]\d{0,4}$/.test(value))
    return invalid(kind);
  return value;
};
const timestamp = (value: unknown, kind: string): number => {
  // Millisecond timestamps, not seconds or numeric strings. Date's finite range is bounded too.
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1e12 ||
    value > 8640000000000000
  )
    return invalid(kind);
  return value;
};

/** Current posted items only; Nexus removes fulfilled/withdrawn requests upstream. */
export function parseNexusBoard(raw: unknown, eventKey: string): NexusBoard {
  const data = object(raw, "event board");
  if (!eventKey || data.eventKey !== eventKey) return invalid("event board");
  const asOf = timestamp(data.dataAsOfTime, "event board");
  const posts = (
    rawPosts: unknown,
    parts: boolean,
  ): (NexusAnnouncement | NexusPartsRequest)[] => {
    if (
      !Array.isArray(rawPosts) ||
      rawPosts.length > NEXUS_BOARD_LIMITS.inputPosts
    )
      return invalid("event board");
    const ids = new Set<string>();
    // Validate every item before retaining a bounded latest subset. A malformed 200
    // must not silently become an empty board or replace a valid cached snapshot.
    return rawPosts
      .map((value) => {
        const row = object(value, "event board");
        const id = cleanText(row.id, 160, "event board");
        if (ids.has(id)) return invalid("event board");
        ids.add(id);
        const text = cleanText(
          parts ? row.parts : row.announcement,
          NEXUS_BOARD_LIMITS.text,
          "event board",
          true,
        );
        const at = timestamp(row.postedTime, "event board");
        return parts
          ? {
              id,
              text,
              at,
              team: teamNumber(row.requestedByTeam, "event board"),
            }
          : { id, text, at };
      })
      .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  };
  const announcements = posts(data.announcements, false) as NexusAnnouncement[];
  const partsRequests = posts(data.partsRequests, true) as NexusPartsRequest[];
  return {
    asOf,
    announcements: announcements.slice(0, NEXUS_BOARD_LIMITS.announcements),
    partsRequests: partsRequests.slice(0, NEXUS_BOARD_LIMITS.partsRequests),
    announcementCount: announcements.length,
    partsRequestCount: partsRequests.length,
  };
}

export function parsePitAddresses(raw: unknown): PitAddresses {
  const rows = Object.entries(object(raw, "pit addresses"));
  if (rows.length > NEXUS_BOARD_LIMITS.addresses)
    return invalid("pit addresses");
  // Numeric team keys cannot become prototype keys. Arbitrary address text is
  // preserved exactly, because it must match an exact map key, not a fuzzy guess.
  return Object.fromEntries(
    rows.map(([team, address]) => [
      teamNumber(team, "pit addresses"),
      cleanText(address, 100, "pit addresses"),
    ]),
  );
}

/** A null value represents a confirmed no-map response (HTTP 404 at the caller). */
export function parsePitMap(raw: unknown): PitMap | null {
  if (raw === null) return null;
  const data = object(raw, "pit map");
  const size = object(data.size, "pit map");
  const dimension = (n: unknown): number => {
    if (
      typeof n !== "number" ||
      !Number.isFinite(n) ||
      n < 1 ||
      n > NEXUS_BOARD_LIMITS.dimension
    )
      return invalid("pit map");
    return n;
  };
  const width = dimension(size.x),
    height = dimension(size.y);
  const finite = (n: unknown, min: number, max: number): number => {
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
      return invalid("pit map");
    return n;
  };
  let count = 0;
  const elements = <T extends PitShape>(
    value: unknown,
    required: boolean,
    limit: number,
    project: (row: Record<string, unknown>, shape: PitShape) => T,
  ): T[] => {
    if (!required && value == null) return [];
    const entries = Object.entries(object(value, "pit map"));
    count += entries.length;
    if (entries.length > limit || count > NEXUS_BOARD_LIMITS.elements)
      return invalid("pit map");
    return entries.map(([id, value]) => {
      cleanText(id, 100, "pit map");
      const row = object(value, "pit map");
      const position = object(row.position, "pit map");
      const size = object(row.size, "pit map");
      // Nexus positions are centers. A small off-canvas extent is valid; the SVG
      // clips to the fixed canvas. Numeric bounds prevent abusive geometry.
      const shape: PitShape = {
        id,
        x: finite(position.x, -width, width * 2),
        y: finite(position.y, -height, height * 2),
        width: finite(size.x, 0.01, width * 2),
        height: finite(size.y, 0.01, height * 2),
        angle: row.angle == null ? 0 : finite(row.angle, -360, 360),
      };
      return project(row, shape);
    });
  };
  const pits = elements(
    data.pits,
    true,
    NEXUS_BOARD_LIMITS.pits,
    (row, shape): MappedPit => ({
      ...shape,
      team: row.team == null ? null : teamNumber(row.team, "pit map"),
    }),
  );
  const label = (row: Record<string, unknown>, shape: PitShape): PitLabel => ({
    ...shape,
    label: cleanText(row.label, 200, "pit map", true),
  });
  const areas = elements(
    data.areas,
    false,
    NEXUS_BOARD_LIMITS.decorations,
    label,
  );
  const labels = elements(
    data.labels,
    false,
    NEXUS_BOARD_LIMITS.decorations,
    label,
  );
  const arrows = elements(
    data.arrows,
    false,
    NEXUS_BOARD_LIMITS.decorations,
    (row, shape): PitArrow => {
      if (row.type !== "single" && row.type !== "double")
        return invalid("pit map");
      if (
        row.color != null &&
        !["red", "blue", "purple", "gray"].includes(row.color as string)
      )
        return invalid("pit map");
      return {
        ...shape,
        type: row.type,
        color: (row.color ?? "blue") as PitArrow["color"],
      };
    },
  );
  const walls = elements(
    data.walls,
    false,
    NEXUS_BOARD_LIMITS.decorations,
    (_row, shape) => shape,
  );
  return { width, height, pits, areas, labels, arrows, walls };
}

/** Exact-only join; conflicting/duplicate assignments never produce a highlight. */
export function findTeamPit(
  team: string,
  map: PitMap | null,
  addresses?: PitAddresses | null,
): MappedPit | null {
  if (!/^[1-9]\d{0,4}$/.test(team) || !map) return null;
  const directlyAssigned = map.pits.filter((pit) => pit.team === team);
  const address = addresses?.[team];
  if (directlyAssigned.length > 1) return null;
  // Conflicting address publications also invalidate a map's direct assignment.
  const candidateAddress = address ?? directlyAssigned[0]?.id;
  if (
    candidateAddress &&
    Object.entries(addresses ?? {}).some(
      ([other, value]) => other !== team && value === candidateAddress,
    )
  )
    return null;
  if (directlyAssigned.length === 1) {
    return address && address !== directlyAssigned[0].id
      ? null
      : directlyAssigned[0];
  }
  if (!address) return null;
  const byAddress = map.pits.filter((pit) => pit.id === address);
  if (
    byAddress.length !== 1 ||
    (byAddress[0].team !== null && byAddress[0].team !== team)
  )
    return null;
  // An address mapped to multiple teams is not an exact assignment.
  if (
    Object.entries(addresses ?? {}).some(
      ([other, value]) => other !== team && value === address,
    )
  )
    return null;
  return byAddress[0];
}
