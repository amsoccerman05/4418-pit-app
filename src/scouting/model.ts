// Independent IMPULSE observations for 2026 REBUILT. Counts are observations,
// never official scores. Unknown ratings remain null, rather than zero.
export type Kind = "match" | "pit";
export type Payload = {
  id: string;
  event_id: string;
  kind: Kind;
  team_number: number;
  match_key: string | null;
  data: Record<string, unknown>;
  supersedes_id?: string | null;
};
export type Observation = Payload & { created_by: string; created_at: string };
export type Assignment = {
  id: string;
  event_id: string;
  kind: Kind;
  team_number: number | null;
  alliance?: "red" | "blue" | null;
  station?: 1 | 2 | 3 | null;
  match_key: string | null;
  assignee_id: string | null;
  version: number;
  notes?: string;
};
export type Pick = {
  id: string;
  event_id: string;
  team_number: number;
  rank: number;
  status: "available" | "picked" | "avoid";
  notes: string;
  version: number;
};
export type ScoutingContext = {
  can_scout: boolean;
  can_manage: boolean;
  observations: Observation[];
  assignments: Assignment[];
  picklist: Pick[];
};
export const choices = {
  alliance: ["unknown", "red", "blue"],
  start_position: ["unknown", "trench", "bump", "hub"],
  auto_climb: ["unknown", "not_attempted", "failed", "succeeded"],
  endgame: ["unknown", "not_attempted", "failed", "L1", "L2", "L3"],
  accuracy: [
    "unknown",
    "under50",
    "50to60",
    "60to70",
    "70to80",
    "80to90",
    "90to100",
  ],
  role: ["unknown", "cycling", "scoring", "feeding", "defending", "immobile"],
  traversal: ["unknown", "trench", "bump", "both", "none"],
  intake: ["unknown", "ground", "outpost", "both", "neither"],
  drive: ["unknown", "swerve", "tank", "other"],
  climb: ["unknown", "none", "L1", "L2", "L3"],
} as const;
export const label = (s: string) =>
  ({
    unknown: "Not observed",
    not_attempted: "Not attempted",
    under50: "Under 50%",
    "50to60": "50–60%",
    "60to70": "60–70%",
    "70to80": "70–80%",
    "80to90": "80–90%",
    "90to100": "90–100%",
  })[s] || s.replaceAll("_", " ").replace(/^./, (x) => x.toUpperCase());
export const initialData = (kind: Kind): Record<string, unknown> =>
  kind === "match"
    ? {
        schema_version: 1,
        match_label: "",
        alliance: "unknown",
        station: null,
        start_position: "unknown",
        auto_fuel: null,
        teleop_fuel: null,
        auto_climb: "unknown",
        endgame: "unknown",
        accuracy: "unknown",
        role: "unknown",
        traversal: "unknown",
        intake: "unknown",
        driver: null,
        defense: null,
        disabled: false,
        no_show: false,
        notes: "",
      }
    : {
        schema_version: 1,
        drive: "unknown",
        intake: "unknown",
        capacity: null,
        traversal: "unknown",
        climb: "unknown",
        auto_notes: "",
        notes: "",
      };
export function normalizeMatchKey(input: string) {
  return input.trim().toLowerCase().replace(/\s+/g, "");
}
const integer = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
export function validateReport(p: Payload): void {
  if (!p.id || !p.event_id) throw new Error("Select an event and report.");
  if (!integer(p.team_number, 1, 99999))
    throw new Error("Enter a team number from 1 to 99999.");
  if (
    !["match", "pit"].includes(p.kind) ||
    !p.data ||
    p.data.schema_version !== 1
  )
    throw new Error("Unsupported scouting form version.");
  const d = p.data;
  const text = (k: string, max: number, required = false) => {
    if (
      typeof d[k] !== "string" ||
      String(d[k]).length > max ||
      (required && !String(d[k]).trim())
    )
      throw new Error(`Check ${k.replaceAll("_", " ")}.`);
  };
  const option = (k: keyof typeof choices) => {
    if (!(choices[k] as readonly unknown[]).includes(d[k]))
      throw new Error(`Choose ${k.replaceAll("_", " ")}.`);
  };
  text("notes", 2000);
  option("intake");
  option("traversal");
  if (p.kind === "match") {
    if (
      !p.match_key ||
      !/^(?:(?:[0-9]{4}[a-z0-9]+_)?(?:qm[0-9]{1,6}|p[0-9]{1,6}|(?:ef|qf|sf|f)[0-9]{1,4}m[0-9]{1,4})|practice:[a-z0-9][a-z0-9_.:-]{0,59}|manual:[0-9a-f-]{36})$/.test(
        p.match_key,
      ) ||
      p.match_key !== normalizeMatchKey(p.match_key)
    )
      throw new Error(
        "Enter a match ID such as qm17, p1, or the scheduled match key.",
      );
    const numbered = p.match_key
      .replace(/^[0-9]{4}[a-z0-9]+_/, "")
      .match(/^(?:qm|p|ef|qf|sf|f)([0-9]+)(?:m([0-9]+))?$/);
    if (
      numbered &&
      (Number(numbered[1]) < 1 || (numbered[2] && Number(numbered[2]) < 1))
    )
      throw new Error("Match and set numbers must be positive.");
    text("match_label", 100, true);
    [
      "alliance",
      "start_position",
      "auto_climb",
      "endgame",
      "accuracy",
      "role",
    ].forEach((k) => option(k as keyof typeof choices));
    for (const k of ["auto_fuel", "teleop_fuel"])
      if (d[k] !== null && !integer(d[k], 0, 999))
        throw new Error("Fuel counts must be whole numbers from 0 to 999.");
    for (const k of ["driver", "defense"])
      if (d[k] !== null && !integer(d[k], 1, 5))
        throw new Error("Ratings must be unobserved or 1–5.");
    if (d.station !== null && !integer(d.station, 1, 3))
      throw new Error("Choose station 1, 2, or 3.");
    if (typeof d.disabled !== "boolean" || typeof d.no_show !== "boolean")
      throw new Error("Check robot status.");
  } else {
    if (p.match_key !== null)
      throw new Error("Pit reports do not have a match.");
    option("drive");
    option("climb");
    text("auto_notes", 2000);
    if (d.capacity !== null && !integer(d.capacity, 0, 200))
      throw new Error("Capacity must be a whole number from 0 to 200.");
  }
}
export function currentReports(observations: Observation[]) {
  const superseded = new Set(
    observations.map((o) => o.supersedes_id).filter(Boolean),
  );
  return observations.filter((o) => !superseded.has(o.id));
}
const average = (v: number[]) =>
  v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
export type Summary = {
  team: number;
  reports: number;
  matches: number;
  autoMatches: number;
  teleopMatches: number;
  fuelMatches: number;
  auto: number | null;
  teleop: number | null;
  fuel: number | null;
  climbRate: number | null;
  disabledRate: number | null;
  driver: number | null;
  defense: number | null;
  pit: Observation | null;
  observations: Observation[];
};
export function summarize(observations: Observation[]): Summary[] {
  const latest = currentReports(observations);
  const teams = [...new Set(latest.map((o) => o.team_number))].sort(
    (a, b) => a - b,
  );
  return teams.map((team) => {
    const all = latest.filter((o) => o.team_number === team),
      matches = all.filter((o) => o.kind === "match"),
      groups = new Map<string, Observation[]>();
    for (const o of matches)
      groups.set(o.match_key!, [...(groups.get(o.match_key!) || []), o]);
    const perMatch = (f: (o: Observation) => number | null) =>
      [...groups.values()]
        .map((g) => average(g.map(f).filter((v): v is number => v !== null)))
        .filter((v): v is number => v !== null);
    const numeric = (k: string) => (o: Observation) =>
      typeof o.data[k] === "number" ? (o.data[k] as number) : null;
    return {
      team,
      reports: matches.length,
      matches: groups.size,
      autoMatches: perMatch(numeric("auto_fuel")).length,
      teleopMatches: perMatch(numeric("teleop_fuel")).length,
      fuelMatches: perMatch((o) =>
        typeof o.data.auto_fuel === "number" &&
        typeof o.data.teleop_fuel === "number"
          ? o.data.auto_fuel + o.data.teleop_fuel
          : null,
      ).length,
      auto: average(perMatch(numeric("auto_fuel"))),
      teleop: average(perMatch(numeric("teleop_fuel"))),
      fuel: average(
        perMatch((o) =>
          typeof o.data.auto_fuel === "number" &&
          typeof o.data.teleop_fuel === "number"
            ? o.data.auto_fuel + o.data.teleop_fuel
            : null,
        ),
      ),
      climbRate: average(
        perMatch((o) =>
          o.data.endgame === "unknown"
            ? null
            : ["L1", "L2", "L3"].includes(String(o.data.endgame))
              ? 1
              : 0,
        ),
      ),
      disabledRate: average(
        perMatch((o) => (o.data.disabled || o.data.no_show ? 1 : 0)),
      ),
      driver: average(perMatch(numeric("driver"))),
      defense: average(perMatch(numeric("defense"))),
      pit:
        all
          .filter((o) => o.kind === "pit")
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null,
      observations: all,
    };
  });
}
// Formula-safe CSV for spreadsheet exports; unknown observations stay blank.
export function csvCell(value: unknown) {
  let s = value == null ? "" : String(value);
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function reportsCsv(observations: Observation[]) {
  const fields = [
    "auto_fuel",
    "teleop_fuel",
    "auto_climb",
    "endgame",
    "accuracy",
    "role",
    "driver",
    "defense",
    "disabled",
    "no_show",
    "drive",
    "capacity",
    "climb",
    "auto_notes",
    "notes",
  ];
  const rows = [
    [
      "report_id",
      "event_id",
      "kind",
      "team_number",
      "match_key",
      "created_at",
      ...fields,
    ],
    ...currentReports(observations).map((o) => [
      o.id,
      o.event_id,
      o.kind,
      o.team_number,
      o.match_key,
      o.created_at,
      ...fields.map((k) => o.data[k]),
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
