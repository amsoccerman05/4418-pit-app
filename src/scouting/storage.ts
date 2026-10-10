/** Own-account, own-event browser storage. Nothing in this module submits automatically. */
export type ScoutingScope = { actorId: string; eventId: string; demo: boolean };
export type ScoutingReportPayload = {
  id: string;
  event_id: string;
  kind: "match" | "pit";
  team_number: number;
  match_key: string | null;
  data: Record<string, unknown>;
  supersedes_id?: string | null;
};
export type ScoutingDraftPayload = Omit<
  ScoutingReportPayload,
  "team_number"
> & {
  team_number: number | null;
};
export type StoredScoutingDraft = ScoutingDraftPayload & {
  createdAt: number;
  updatedAt: number;
  revision: string;
};
export type ScoutingOutboxStatus = "queued" | "syncing" | "synced" | "error";
export type ScoutingOutboxRecord = {
  payload: ScoutingReportPayload;
  status: ScoutingOutboxStatus;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
  syncedAt: number | null;
  /** An active cross-tab attempt can be recovered after this time. */
  retryAt: number | null;
};
export type StorageLike = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;
export type ScoutingReadIssue = { key: string; message: string };
export type ScoutingSyncAcknowledgment = { id: string; status: "saved" };
export type ScoutingSyncSummary = {
  synced: number;
  failed: number;
  skipped: number;
};
export type ScoutingSyncOptions = {
  ids?: string[];
  /** Re-check the current authenticated account/event before each request. */
  shouldContinue?: () => boolean;
  onChange?: (record: ScoutingOutboxRecord) => void;
};
export type ScoutingStoreOptions = {
  now?: () => number;
  uuid?: () => string;
  validateReport?: (payload: ScoutingReportPayload) => void;
  syncTimeoutMs?: number;
};
export type ScoutingDraftWriteOptions = { expectedRevision?: string | null };
export type ScoutingQueueOptions = { draftId?: string };
export type ScoutingImportResult = { drafts: number; reports: number };
export type ScoutingStore = {
  readonly scope: Readonly<ScoutingScope>;
  readonly storagePrefix: string;
  listDrafts(): StoredScoutingDraft[];
  getDraft(id: string): StoredScoutingDraft | null;
  saveDraft(
    draft: ScoutingDraftPayload,
    options?: ScoutingDraftWriteOptions,
  ): StoredScoutingDraft;
  deleteDraft(id: string, options?: ScoutingDraftWriteOptions): void;
  queueReport(
    payload: ScoutingReportPayload,
    options?: ScoutingQueueOptions,
  ): ScoutingOutboxRecord;
  listOutbox(): ScoutingOutboxRecord[];
  getReport(id: string): ScoutingOutboxRecord | null;
  syncReports(
    submit: (
      payload: ScoutingReportPayload,
    ) => Promise<ScoutingSyncAcknowledgment>,
    options?: ScoutingSyncOptions,
  ): Promise<ScoutingSyncSummary>;
  getReadIssues(): ScoutingReadIssue[];
  exportRecords(): string;
  importRecords(json: string): ScoutingImportResult;
};
export type ScoutingStorageErrorCode =
  "invalid" | "unavailable" | "write_failed" | "corrupt" | "conflict";
export class ScoutingStorageError extends Error {
  readonly code: ScoutingStorageErrorCode;
  constructor(code: ScoutingStorageErrorCode, message: string) {
    super(message);
    this.name = "ScoutingStorageError";
    this.code = code;
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAYLOAD_CHARS = 64_000;
const MAX_IMPORT_CHARS = 5_000_000;
const MAX_REQUEST_MS = 120_000;
const PAYLOAD_KEYS = new Set([
  "id",
  "event_id",
  "kind",
  "team_number",
  "match_key",
  "data",
  "supersedes_id",
]);
const interrupted =
  "Sync was interrupted. Your report is still saved here; retry to confirm it.";

export function newScoutingId(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  if (!crypto?.getRandomValues)
    throw new ScoutingStorageError(
      "unavailable",
      "Secure report IDs are unavailable in this browser.",
    );
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function invalid(message: string): never {
  throw new ScoutingStorageError("invalid", message);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !UUID.test(id))
    invalid("A valid client-generated report UUID is required.");
}
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
/** Also rejects values that JSON.stringify would silently discard or change. */
function stableJson(
  value: unknown,
  depth = 0,
  ancestors = new Set<object>(),
): string {
  if (depth > 20) invalid("Scouting data is nested too deeply.");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (typeof value !== "object" || value === null || ancestors.has(value))
    invalid("Scouting data must contain only finite JSON values.");
  ancestors.add(value);
  let result: string;
  if (Array.isArray(value)) {
    if (value.length > 2_000)
      invalid("Scouting data contains too many values.");
    // Array.map skips sparse entries; explicit iteration makes them invalid.
    result = `[${Array.from(value, (entry) => stableJson(entry, depth + 1, ancestors)).join(",")}]`;
  } else {
    if (!isObject(value))
      invalid("Scouting data must contain only plain JSON objects.");
    const keys = Object.keys(value).sort();
    if (keys.length > 2_000) invalid("Scouting data contains too many fields.");
    result = `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key], depth + 1, ancestors)}`).join(",")}}`;
  }
  ancestors.delete(value);
  if (result.length > MAX_PAYLOAD_CHARS)
    invalid("This scouting record is too large to save.");
  return result;
}
function boundedError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Sync could not be confirmed. Retry when connected.";
  return (
    message
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, 240) || "Sync could not be confirmed. Retry when connected."
  );
}
function sameScope(value: unknown, scope: ScoutingScope): boolean {
  return (
    isObject(value) &&
    value.actorId === scope.actorId &&
    value.eventId === scope.eventId &&
    value.demo === scope.demo
  );
}

type Envelope = { version: 1; scope: ScoutingScope };
type SavedReport = Envelope & {
  createdAt: number;
  payload: ScoutingReportPayload;
};
type SavedDraft = Envelope & { draft: StoredScoutingDraft };
type Attempt = Envelope & {
  token: string;
  reportId: string;
  startedAt: number;
  leaseUntil: number;
  finishedAt: number | null;
  attempts: number;
  error: string | null;
};
type Receipt = Envelope & {
  payload: ScoutingReportPayload;
  confirmedAt: number;
};

export function createScoutingStore(
  storage: StorageLike,
  inputScope: ScoutingScope,
  options: ScoutingStoreOptions = {},
): ScoutingStore {
  if (
    !inputScope ||
    typeof inputScope.actorId !== "string" ||
    !inputScope.actorId.trim() ||
    inputScope.actorId.length > 200 ||
    typeof inputScope.eventId !== "string" ||
    !inputScope.eventId.trim() ||
    inputScope.eventId.length > 200 ||
    typeof inputScope.demo !== "boolean"
  )
    invalid(
      "An authenticated account and event are required for scouting storage.",
    );
  const scope = Object.freeze({ ...inputScope });
  const storagePrefix = `4418:scouting:v1:${encodeURIComponent(scope.actorId)}:${encodeURIComponent(scope.eventId)}:${scope.demo ? "demo" : "live"}:`;
  const now = options.now || Date.now;
  const uuid = options.uuid || newScoutingId;
  const timeoutMs = options.syncTimeoutMs ?? 20_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_REQUEST_MS
  )
    invalid("Invalid scouting sync timeout.");
  const issues = new Map<string, string>();
  let activeSync: Promise<ScoutingSyncSummary> | null = null;
  const envelope = (): Envelope => ({ version: 1, scope: { ...scope } });
  const keyFor = (
    kind: "draft" | "report" | "attempt" | "receipt",
    id: string,
  ) => {
    assertId(id);
    return `${storagePrefix}${kind}:${id.toLowerCase()}`;
  };
  function getTime() {
    const value = now();
    if (!timestamp(value)) invalid("The device clock is invalid.");
    return value;
  }
  function nextId() {
    const id = uuid();
    assertId(id);
    return id.toLowerCase();
  }
  function raw(key: string): string | null {
    try {
      return storage.getItem(key);
    } catch {
      throw new ScoutingStorageError(
        "unavailable",
        "Browser storage is unavailable. Your scouting data has not been read or changed.",
      );
    }
  }
  function read(key: string): Record<string, unknown> | null {
    const value = raw(key);
    if (value === null) {
      issues.delete(key);
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        !isObject(parsed) ||
        parsed.version !== 1 ||
        !sameScope(parsed.scope, scope)
      )
        throw new Error();
      return parsed;
    } catch {
      issues.set(
        key,
        "A local scouting record is unreadable. It has been kept on this device.",
      );
      throw new ScoutingStorageError(
        "corrupt",
        "A local scouting record is unreadable. It has been kept on this device.",
      );
    }
  }
  function corrupt(key: string): never {
    const message =
      "A local scouting record has invalid contents. It has been kept on this device.";
    issues.set(key, message);
    throw new ScoutingStorageError("corrupt", message);
  }
  function write(key: string, value: unknown) {
    const text = JSON.stringify(value);
    try {
      storage.setItem(key, text);
      if (storage.getItem(key) !== text)
        throw new Error("Unconfirmed browser write");
      issues.delete(key);
    } catch {
      throw new ScoutingStorageError(
        "write_failed",
        "Browser storage could not confirm this save. It may be full or disabled; keep this form open and export any existing records.",
      );
    }
  }
  function remove(key: string) {
    try {
      storage.removeItem(key);
      if (storage.getItem(key) !== null) throw new Error();
      issues.delete(key);
    } catch {
      throw new ScoutingStorageError(
        "write_failed",
        "The local record could not be removed. It is safe to retry.",
      );
    }
  }
  function keys(kind: "draft" | "report"): string[] {
    try {
      const found = new Set<string>();
      // Individual keys, never an array read/modify/write that can erase another tab's work.
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(`${storagePrefix}${kind}:`)) found.add(key);
      }
      return [...found].sort();
    } catch {
      throw new ScoutingStorageError(
        "unavailable",
        "Browser storage is unavailable. No scouting records were removed.",
      );
    }
  }
  function normalize(value: unknown, draft: true): ScoutingDraftPayload;
  function normalize(value: unknown, draft: false): ScoutingReportPayload;
  function normalize(value: unknown, draft: boolean): ScoutingDraftPayload {
    if (
      !isObject(value) ||
      Object.keys(value).some((key) => !PAYLOAD_KEYS.has(key))
    )
      invalid("Invalid scouting record fields.");
    assertId(value.id);
    if (value.event_id !== scope.eventId)
      invalid("This scouting record belongs to a different event.");
    if (value.kind !== "match" && value.kind !== "pit")
      invalid("Invalid scouting record kind.");
    if (
      !(draft && value.team_number === null) &&
      !(
        typeof value.team_number === "number" &&
        Number.isSafeInteger(value.team_number) &&
        value.team_number > 0 &&
        value.team_number <= 999_999
      )
    )
      invalid("Enter a valid team number.");
    if (
      value.match_key !== null &&
      (typeof value.match_key !== "string" || value.match_key.length > 160)
    )
      invalid("Invalid scouting match key.");
    if (
      !draft &&
      value.kind === "match" &&
      (typeof value.match_key !== "string" || !value.match_key.trim())
    )
      invalid("A match report needs a match key.");
    if (value.kind === "pit" && value.match_key !== null)
      invalid("A pit report must not have a match key.");
    if (!isObject(value.data)) invalid("Scouting data must be an object.");
    if (value.supersedes_id != null) {
      assertId(value.supersedes_id);
      if (value.supersedes_id.toLowerCase() === value.id.toLowerCase())
        invalid("A correction must have a new report UUID.");
    }
    const normalized: ScoutingDraftPayload = {
      id: value.id.toLowerCase(),
      event_id: scope.eventId,
      kind: value.kind,
      team_number: value.team_number as number | null,
      match_key: value.match_key as string | null,
      data: value.data,
      supersedes_id:
        typeof value.supersedes_id === "string"
          ? value.supersedes_id.toLowerCase()
          : null,
    };
    const json = stableJson(normalized);
    if (json.length > MAX_PAYLOAD_CHARS)
      invalid("This scouting record is too large to save.");
    const result = JSON.parse(json) as ScoutingDraftPayload;
    if (!draft)
      options.validateReport?.(JSON.parse(json) as ScoutingReportPayload);
    return result;
  }
  function payloadOf(draft: StoredScoutingDraft): ScoutingDraftPayload {
    const {
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      revision: _revision,
      ...payload
    } = draft;
    return payload;
  }
  function getDraft(id: string): StoredScoutingDraft | null {
    const key = keyFor("draft", id);
    const saved = read(key);
    if (!saved) return null;
    try {
      if (!isObject(saved.draft)) return corrupt(key);
      const { createdAt, updatedAt, revision, ...payload } = saved.draft;
      if (
        !timestamp(createdAt) ||
        !timestamp(updatedAt) ||
        updatedAt < createdAt ||
        typeof revision !== "string" ||
        !UUID.test(revision)
      )
        return corrupt(key);
      const clean = normalize(payload, true);
      if (clean.id !== id.toLowerCase()) return corrupt(key);
      issues.delete(key);
      return { ...clean, createdAt, updatedAt, revision };
    } catch (error) {
      if (error instanceof ScoutingStorageError && error.code === "unavailable")
        throw error;
      return corrupt(key);
    }
  }
  function saveDraft(
    value: ScoutingDraftPayload,
    config: ScoutingDraftWriteOptions = {},
  ): StoredScoutingDraft {
    const clean = normalize(value, true);
    const old = getDraft(clean.id);
    if (
      config.expectedRevision !== undefined &&
      config.expectedRevision !== (old?.revision ?? null)
    )
      throw new ScoutingStorageError(
        "conflict",
        "This draft changed in another tab. Reopen it before saving.",
      );
    const time = getTime();
    const draft: StoredScoutingDraft = {
      ...clean,
      createdAt: old?.createdAt ?? time,
      updatedAt: Math.max(time, old?.updatedAt ?? time),
      revision: nextId(),
    };
    write(keyFor("draft", clean.id), {
      ...envelope(),
      draft,
    } satisfies SavedDraft);
    return draft;
  }
  function deleteDraft(id: string, config: ScoutingDraftWriteOptions = {}) {
    const draft = getDraft(id);
    if (
      config.expectedRevision !== undefined &&
      config.expectedRevision !== (draft?.revision ?? null)
    )
      throw new ScoutingStorageError(
        "conflict",
        "This draft changed in another tab. Reopen it before deleting.",
      );
    if (draft) remove(keyFor("draft", id));
  }
  function getSavedReport(id: string): SavedReport | null {
    const key = keyFor("report", id);
    const saved = read(key);
    if (!saved) return null;
    try {
      if (!timestamp(saved.createdAt)) return corrupt(key);
      const payload = normalize(saved.payload, false);
      if (payload.id !== id.toLowerCase()) return corrupt(key);
      issues.delete(key);
      return { ...envelope(), createdAt: saved.createdAt, payload };
    } catch (error) {
      if (error instanceof ScoutingStorageError && error.code === "unavailable")
        throw error;
      return corrupt(key);
    }
  }
  function getAttempt(id: string): Attempt | null {
    const key = keyFor("attempt", id);
    const value = read(key);
    if (!value) return null;
    if (
      value.reportId !== id ||
      typeof value.token !== "string" ||
      !UUID.test(value.token) ||
      !timestamp(value.startedAt) ||
      !timestamp(value.leaseUntil) ||
      value.leaseUntil < value.startedAt ||
      value.leaseUntil > value.startedAt + MAX_REQUEST_MS + 1_000 ||
      !Number.isSafeInteger(value.attempts) ||
      (value.attempts as number) < 1 ||
      !(value.finishedAt === null || timestamp(value.finishedAt)) ||
      !(
        value.error === null ||
        (typeof value.error === "string" && value.error.length <= 240)
      )
    )
      return corrupt(key);
    issues.delete(key);
    return value as unknown as Attempt;
  }
  function getReceipt(report: SavedReport): Receipt | null {
    const key = keyFor("receipt", report.payload.id);
    const value = read(key);
    if (!value) return null;
    try {
      if (
        !timestamp(value.confirmedAt) ||
        stableJson(value.payload) !== stableJson(report.payload)
      )
        return corrupt(key);
      issues.delete(key);
      return value as unknown as Receipt;
    } catch {
      return corrupt(key);
    }
  }
  function getReport(id: string): ScoutingOutboxRecord | null {
    const saved = getSavedReport(id);
    if (!saved) return null;
    let attempt: Attempt | null = null;
    let receipt: Receipt | null = null;
    let statusError: string | null = null;
    try {
      receipt = getReceipt(saved);
    } catch (error) {
      if (!(error instanceof ScoutingStorageError) || error.code !== "corrupt")
        throw error;
      statusError = error.message;
    }
    try {
      attempt = getAttempt(saved.payload.id);
    } catch (error) {
      if (!(error instanceof ScoutingStorageError) || error.code !== "corrupt")
        throw error;
      statusError = error.message;
    }
    const expired =
      attempt && attempt.finishedAt === null && attempt.leaseUntil <= getTime();
    return {
      payload: saved.payload,
      status: receipt
        ? "synced"
        : statusError || expired || attempt?.error
          ? "error"
          : attempt
            ? "syncing"
            : "queued",
      createdAt: saved.createdAt,
      updatedAt:
        receipt?.confirmedAt ??
        attempt?.finishedAt ??
        attempt?.startedAt ??
        saved.createdAt,
      attempts: attempt?.attempts ?? 0,
      lastError: receipt
        ? null
        : (statusError ?? (expired ? interrupted : (attempt?.error ?? null))),
      syncedAt: receipt?.confirmedAt ?? null,
      retryAt:
        !receipt && attempt?.finishedAt === null ? attempt.leaseUntil : null,
    };
  }
  function list<T>(
    kind: "draft" | "report",
    getter: (id: string) => T | null,
  ): T[] {
    const result: T[] = [];
    for (const key of keys(kind)) {
      try {
        const value = getter(key.slice(`${storagePrefix}${kind}:`.length));
        if (value) result.push(value);
      } catch (error) {
        if (
          !(error instanceof ScoutingStorageError) ||
          (error.code !== "corrupt" && error.code !== "invalid")
        )
          throw error;
        issues.set(key, error.message);
      }
    }
    return result;
  }
  function listDrafts() {
    return list("draft", getDraft).sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    );
  }
  function listOutbox() {
    return list("report", getReport).sort(
      (a, b) =>
        a.createdAt - b.createdAt || a.payload.id.localeCompare(b.payload.id),
    );
  }
  function queueReport(
    value: ScoutingReportPayload,
    config: ScoutingQueueOptions = {},
  ): ScoutingOutboxRecord {
    const payload = normalize(value, false);
    const old = getSavedReport(payload.id);
    if (old && stableJson(old.payload) !== stableJson(payload))
      throw new ScoutingStorageError(
        "conflict",
        "This report UUID already belongs to different observations. Create a new report or correction.",
      );
    // Preserve a newer draft if another tab edits it while queueing.
    const draft = config.draftId ? getDraft(config.draftId) : null;
    if (!old)
      write(keyFor("report", payload.id), {
        ...envelope(),
        createdAt: getTime(),
        payload,
      } satisfies SavedReport);
    const confirmed = getReport(payload.id);
    if (!confirmed || stableJson(confirmed.payload) !== stableJson(payload))
      throw new ScoutingStorageError(
        "conflict",
        "This report could not be confirmed because it changed in another tab.",
      );
    const draftMatches =
      draft &&
      stableJson({ ...payloadOf(draft), id: payload.id }) ===
        stableJson(payload);
    if (draft && draftMatches) {
      try {
        deleteDraft(draft.id, { expectedRevision: draft.revision });
      } catch (error) {
        issues.set(
          keyFor("draft", draft.id),
          `The report is queued, but its draft was kept: ${boundedError(error)}`,
        );
      }
    } else if (draft) {
      issues.set(
        keyFor("draft", draft.id),
        "The report is queued, and its differing draft has been kept for review.",
      );
    }
    return confirmed;
  }
  function notify(
    callback: ScoutingSyncOptions["onChange"],
    record: ScoutingOutboxRecord | null,
  ) {
    // A rendering exception must never change a confirmed receipt into a failed submission.
    if (record && callback) {
      try {
        callback(record);
      } catch {
        /* caller owns UI errors */
      }
    }
  }
  async function runSync(
    submit: (
      payload: ScoutingReportPayload,
    ) => Promise<ScoutingSyncAcknowledgment>,
    config: ScoutingSyncOptions,
  ): Promise<ScoutingSyncSummary> {
    const summary: ScoutingSyncSummary = { synced: 0, failed: 0, skipped: 0 };
    const selected = config.ids
      ? new Set(
          config.ids.map((id) => {
            assertId(id);
            return id.toLowerCase();
          }),
        )
      : null;
    const candidates = listOutbox().filter(
      (record) => !selected || selected.has(record.payload.id),
    );
    for (const candidate of candidates) {
      if (config.shouldContinue && !config.shouldContinue()) {
        summary.skipped++;
        continue;
      }
      const record = getReport(candidate.payload.id);
      if (
        !record ||
        record.status === "synced" ||
        record.status === "syncing"
      ) {
        summary.skipped++;
        continue;
      }
      const time = getTime();
      const attempt: Attempt = {
        ...envelope(),
        token: nextId(),
        reportId: record.payload.id,
        startedAt: time,
        leaseUntil: time + timeoutMs + 1_000,
        finishedAt: null,
        attempts: record.attempts + 1,
        error: null,
      };
      // Persist the attempt before sending. A quota/privacy failure must prevent the request.
      write(keyFor("attempt", record.payload.id), attempt);
      const claimed = getAttempt(record.payload.id);
      if (claimed?.token !== attempt.token) {
        summary.skipped++;
        continue;
      }
      notify(config.onChange, getReport(record.payload.id));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (config.shouldContinue && !config.shouldContinue()) {
          write(keyFor("attempt", record.payload.id), {
            ...attempt,
            finishedAt: getTime(),
            error:
              "Sync stopped because the active account or event changed. Retry from this account and event.",
          });
          summary.skipped++;
          continue;
        }
        const acknowledgment = await Promise.race([
          Promise.resolve().then(() =>
            submit(
              JSON.parse(stableJson(record.payload)) as ScoutingReportPayload,
            ),
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Sync timed out. The server may have received this report; retry uses the same UUID safely.",
                  ),
                ),
              timeoutMs,
            );
          }),
        ]);
        if (
          !acknowledgment ||
          acknowledgment.id?.toLowerCase() !== record.payload.id ||
          acknowledgment.status !== "saved"
        )
          throw new Error(
            "The server did not confirm this report. It is still saved here; retry to confirm it.",
          );
        const current = getSavedReport(record.payload.id);
        if (
          !current ||
          stableJson(current.payload) !== stableJson(record.payload)
        )
          throw new ScoutingStorageError(
            "conflict",
            "The local report changed during sync. Its result could not be confirmed.",
          );
        // Separate durable receipt wins over all concurrent/stale attempt errors.
        write(keyFor("receipt", record.payload.id), {
          ...envelope(),
          payload: record.payload,
          confirmedAt: getTime(),
        } satisfies Receipt);
        summary.synced++;
      } catch (error) {
        const current = getReport(record.payload.id);
        if (current?.status === "synced") summary.synced++;
        else {
          const latest = getAttempt(record.payload.id);
          if (latest?.token === attempt.token)
            write(keyFor("attempt", record.payload.id), {
              ...attempt,
              finishedAt: getTime(),
              error: boundedError(error),
            });
          summary.failed++;
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        notify(config.onChange, getReport(record.payload.id));
      }
    }
    return summary;
  }
  function syncReports(
    submit: (
      payload: ScoutingReportPayload,
    ) => Promise<ScoutingSyncAcknowledgment>,
    config: ScoutingSyncOptions = {},
  ) {
    if (activeSync) return activeSync;
    activeSync = runSync(submit, config).finally(() => {
      activeSync = null;
    });
    return activeSync;
  }
  function exportRecords(): string {
    const drafts = listDrafts().map(payloadOf);
    const reports = listOutbox().map((record) => record.payload);
    // A partial export must not be represented as a complete backup.
    if (issues.size)
      throw new ScoutingStorageError(
        "corrupt",
        "Some local records are unreadable. A complete export could not be created; no records were removed.",
      );
    return JSON.stringify(
      {
        format: "4418-scouting",
        version: 1,
        scope,
        exportedAt: getTime(),
        drafts,
        reports,
      },
      null,
      2,
    );
  }
  function importRecords(json: string): ScoutingImportResult {
    if (typeof json !== "string" || json.length > MAX_IMPORT_CHARS)
      invalid("This scouting import is too large.");
    let source: unknown;
    try {
      source = JSON.parse(json);
    } catch {
      invalid("This file is not valid scouting JSON.");
    }
    if (
      !isObject(source) ||
      source.format !== "4418-scouting" ||
      source.version !== 1 ||
      !sameScope(source.scope, scope) ||
      !Array.isArray(source.drafts) ||
      !Array.isArray(source.reports) ||
      source.drafts.length + source.reports.length > 2_000
    )
      invalid(
        "Import requires a scouting export from this same account, event, and demo/live mode.",
      );
    // Validate the complete file and all ID collisions before writing any of it.
    const drafts = source.drafts.map((value) => normalize(value, true));
    const reports = source.reports.map((value) => normalize(value, false));
    const seen = new Map<string, string>();
    for (const [kind, entries] of [
      ["draft", drafts],
      ["report", reports],
    ] as const) {
      for (const value of entries) {
        const key = `${kind}:${value.id}`;
        const serialized = stableJson(value);
        const prior = seen.get(key);
        const existing =
          kind === "draft" ? getDraft(value.id) : getReport(value.id);
        const existingPayload = existing
          ? "payload" in existing
            ? existing.payload
            : payloadOf(existing)
          : null;
        if (
          (prior && prior !== serialized) ||
          (existingPayload && stableJson(existingPayload) !== serialized)
        )
          throw new ScoutingStorageError(
            "conflict",
            "An imported UUID has different local observations. Nothing from this file was imported.",
          );
        seen.set(key, serialized);
      }
    }
    const result = { drafts: 0, reports: 0 };
    try {
      for (const draft of drafts)
        if (!getDraft(draft.id)) {
          saveDraft(draft, { expectedRevision: null });
          result.drafts++;
        }
      for (const report of reports)
        if (!getReport(report.id)) {
          queueReport(report);
          result.reports++;
        }
    } catch (error) {
      if (
        error instanceof ScoutingStorageError &&
        error.code === "write_failed"
      )
        throw new ScoutingStorageError(
          "write_failed",
          "Import stopped because browser storage could not confirm a save. Some records may already be saved; nothing was removed and you can safely retry this file.",
        );
      throw error;
    }
    return result;
  }
  return {
    scope,
    storagePrefix,
    listDrafts,
    getDraft,
    saveDraft,
    deleteDraft,
    queueReport,
    listOutbox,
    getReport,
    syncReports,
    getReadIssues: () =>
      [...issues].map(([key, message]) => ({ key, message })),
    exportRecords,
    importRecords,
  };
}
