import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Profile } from "../model";
import { scopedPitRpc, type PitScope } from "../pit-rpc";
import {
  accessFailure,
  offlineNow,
  PRIVATE_SNAPSHOT_MAX_AGE_MS,
} from "../connection";
import {
  createScoutingStore,
  type ScoutingDraftPayload,
  type ScoutingReadIssue,
  type StoredScoutingDraft,
  type ScoutingOutboxRecord,
} from "./storage";
import { validateReport, type Payload, type ScoutingContext } from "./model";

import { validAssignment } from "./stations";

const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : String(
        (error as { message?: string } | null)?.message ||
          "Scouting request failed.",
      );
const activeScout = (profile: Profile) =>
  profile.active &&
  ["student", "lead", "mentor", "admin"].includes(profile.role);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Do not render a cross-event or malformed response as trusted team data. */
function checkedContext(value: unknown, eventId: string): ScoutingContext {
  if (!value || typeof value !== "object")
    throw new Error("Unexpected scouting response. Refresh to try again.");
  const result = value as ScoutingContext;
  if (
    typeof result.can_scout !== "boolean" ||
    typeof result.can_manage !== "boolean" ||
    !Array.isArray(result.observations) ||
    !Array.isArray(result.assignments) ||
    !Array.isArray(result.picklist)
  )
    throw new Error("Unexpected scouting response. Refresh to try again.");
  for (const record of [
    ...result.observations,
    ...result.assignments,
    ...result.picklist,
  ]) {
    if (
      !record ||
      record.event_id !== eventId ||
      typeof record.id !== "string" ||
      !uuid.test(record.id)
    )
      throw new Error(
        "Scouting event changed or returned invalid records. Refresh to try again.",
      );
  }
  for (const assignment of result.assignments)
    if (!validAssignment(assignment))
      throw new Error("Unexpected scouting assignment. Refresh to try again.");
  for (const pick of result.picklist)
    if (
      !Number.isInteger(pick.team_number) ||
      pick.team_number < 1 ||
      pick.team_number > 99999
    )
      throw new Error("Unexpected scouting pick. Refresh to try again.");
  for (const report of result.observations) {
    validateReport(report);
    if (
      typeof report.created_at !== "string" ||
      !Number.isFinite(Date.parse(report.created_at)) ||
      typeof report.created_by !== "string"
    )
      throw new Error("Unexpected scouting report. Refresh to try again.");
  }
  return result;
}

type View = { key: string; signal: AbortSignal };
type ScopedError = { view: View; message: string } | null;
type ReadRequest = {
  view: View;
  controller: AbortController;
  promise: Promise<boolean> | null;
  reviewed: boolean;
};
type Operation = { view: View };

export function useScouting(
  profile: Profile,
  eventId: string,
  demo: boolean,
  scope: PitScope,
  onAccessFailure: () => void,
) {
  const key = JSON.stringify([demo, profile.id, eventId]);
  const view = useMemo<View>(
    () => ({ key, signal: scope.signal }),
    [key, scope.signal],
  );
  const current = useRef(view);
  current.current = view;
  const latest = useRef({ profile, scope, onAccessFailure });
  latest.current = { profile, scope, onAccessFailure };
  const mounted = useRef(true);
  const denied = useRef<View | null>(null);
  const inflight = useRef<ReadRequest | null>(null);
  const operation = useRef<Operation | null>(null);
  const drainRequested = useRef<View | null>(null);
  const automaticSync = useRef<(() => Promise<void>) | null>(null);
  const interruptedRetry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [revision, bump] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [readError, setReadError] = useState<ScopedError>(null);
  const [writeError, setWriteError] = useState<ScopedError>(null);
  const [uncertain, setUncertain] = useState<View | null>(null);
  const [working, setWorking] = useState<Operation | null>(null);
  const [online, setOnline] = useState(!offlineNow());
  const [snapshot, setSnapshot] = useState<{
    view: View;
    value: ScoutingContext;
    at: number;
  } | null>(null);
  const storeResult = useMemo(() => {
    try {
      return {
        store: createScoutingStore(
          localStorage,
          { actorId: profile.id, eventId, demo },
          { validateReport },
        ),
        error: "",
      };
    } catch (error) {
      return { store: null, error: message(error) };
    }
  }, [key]);
  const store = storeResult.store;
  const live = () =>
    mounted.current &&
    current.current === view &&
    denied.current !== view &&
    latest.current.profile.active &&
    latest.current.scope.actorId === profile.id &&
    !view.signal.aborted &&
    latest.current.scope.isCurrent();
  const mayScout = () => live() && activeScout(latest.current.profile);
  const scoped = (signal = scope.signal): PitScope => ({
    actorId: profile.id,
    signal,
    isCurrent: live,
  });
  const revoke = () => {
    denied.current = view;
    setSnapshot(null);
    bump((value) => value + 1);
    latest.current.onAccessFailure();
  };
  const refresh = useCallback(
    async (reviewed = true, supersede = false): Promise<boolean> => {
      // Refresh is read-only. Only reviewed reports in the outbox can upload.
      if (!eventId || demo || !live()) return false;
      if (offlineNow()) {
        setReadError({
          view,
          message: "Offline. Showing last loaded team scouting data.",
        });
        return false;
      }
      if (inflight.current?.view === view && !supersede) {
        if (reviewed) inflight.current.reviewed = true;
        return inflight.current.promise || false;
      }
      inflight.current?.controller.abort();
      const request: ReadRequest = {
        view,
        controller: new AbortController(),
        promise: null,
        reviewed,
      };
      inflight.current = request;
      const cancel = () => request.controller.abort();
      scope.signal.addEventListener("abort", cancel, { once: true });
      const valid = () =>
        live() &&
        inflight.current === request &&
        !request.controller.signal.aborted;
      request.promise = (async () => {
        try {
          const { data, error } = await scopedPitRpc(
            "pit_scouting_context",
            { event_id: eventId },
            scoped(request.controller.signal),
          );
          if (error) throw error;
          if (!valid()) return false;
          const value = checkedContext(data, eventId);
          const at = Date.now();
          setSnapshot({ view, value, at });
          setClock(at);
          setReadError(null);
          if (request.reviewed) {
            setWriteError(null);
            setUncertain(null);
          }
          return true;
        } catch (error) {
          if (valid()) {
            setReadError({ view, message: message(error) });
            if (accessFailure(error)) revoke();
          }
          return false;
        } finally {
          scope.signal.removeEventListener("abort", cancel);
          if (inflight.current === request) inflight.current = null;
        }
      })();
      return request.promise;
    },
    [view, eventId, demo],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inflight.current?.controller.abort();
      inflight.current = null;
    };
  }, []);
  useEffect(() => {
    void refresh(false);
    void automaticSync.current?.();
    const tick = setInterval(() => {
      setClock(Date.now());
      if (typeof document === "undefined" || !document.hidden)
        void refresh(false);
    }, 30_000);
    const onlineChanged = () => {
      setOnline(!offlineNow());
      setClock(Date.now());
      if (!offlineNow()) {
        void refresh(false);
        void automaticSync.current?.();
      }
    };
    const changed = (event: StorageEvent) => {
      if (
        !event.key ||
        event.key.startsWith(store?.storagePrefix || "4418:scouting:")
      )
        bump((value) => value + 1);
    };
    window.addEventListener("online", onlineChanged);
    window.addEventListener("offline", onlineChanged);
    window.addEventListener("storage", changed);
    return () => {
      clearInterval(tick);
      if (interruptedRetry.current !== null) {
        clearTimeout(interruptedRetry.current);
        interruptedRetry.current = null;
      }
      window.removeEventListener("online", onlineChanged);
      window.removeEventListener("offline", onlineChanged);
      window.removeEventListener("storage", changed);
      if (inflight.current?.view === view) {
        inflight.current.controller.abort();
        inflight.current = null;
      }
    };
  }, [refresh, store]);
  const safe = <T>(fn: () => T): T | null => {
    try {
      if (!mayScout())
        throw new Error("An active scouting account is required.");
      setWriteError(null);
      const result = fn();
      bump((value) => value + 1);
      return result;
    } catch (error) {
      if (current.current === view && mounted.current)
        setWriteError({ view, message: message(error) });
      return null;
    }
  };
  const saveDraft = (
    draft: ScoutingDraftPayload,
    expectedRevision?: string | null,
  ) =>
    safe(() => {
      if (!store)
        throw new Error(storeResult.error || "Local storage unavailable.");
      return store.saveDraft(draft, { expectedRevision });
    });
  const queue = (payload: Payload, draftId?: string) =>
    safe(() => {
      if (!store)
        throw new Error(storeResult.error || "Local storage unavailable.");
      return store.queueReport(payload, { draftId });
    });
  const begin = () => {
    if (operation.current?.view === view) return null;
    const job = { view };
    operation.current = job;
    setWorking(job);
    return job;
  };
  const finish = (job: Operation) => {
    if (operation.current === job) {
      operation.current = null;
      setWorking(null);
      if (drainRequested.current === view && live()) {
        drainRequested.current = null;
        void Promise.resolve().then(() => automaticSync.current?.());
      }
    }
    if (live()) bump((value) => value + 1);
  };
  const scheduleInterrupted = (records: ScoutingOutboxRecord[]) => {
    if (interruptedRetry.current !== null)
      clearTimeout(interruptedRetry.current);
    interruptedRetry.current = null;
    const times = records
      .filter(
        (record) => record.status === "syncing" && record.retryAt !== null,
      )
      .map((record) => record.retryAt!);
    if (times.length && live())
      interruptedRetry.current = setTimeout(
        () => {
          interruptedRetry.current = null;
          void automaticSync.current?.();
        },
        Math.max(1, Math.min(...times) - Date.now() + 10),
      );
  };
  const sync = async (automatic = false) => {
    if (!store || !mayScout()) return;
    if (!demo && offlineNow()) {
      if (!automatic)
        setWriteError({
          view,
          message:
            "Offline. Submitted reports stay on this device and upload when reconnected.",
        });
      return;
    }
    try {
      const records = store.listOutbox();
      if (automatic) scheduleInterrupted(records);
      if (
        !records.some(
          (record) => record.status === "queued" || record.status === "error",
        )
      )
        return;
    } catch (error) {
      if (live()) setWriteError({ view, message: message(error) });
      return;
    }
    const job = begin();
    if (!job) {
      drainRequested.current = view;
      return;
    }
    setWriteError(null);
    try {
      await store.syncReports(
        async (payload) => {
          if (!mayScout())
            throw new Error("Account changed; report retained on this device.");
          if (demo) return { id: payload.id, status: "saved" as const };
          const { data, error } = await scopedPitRpc(
            "pit_scouting_submit",
            { p: payload },
            scoped(),
          );
          if (error) {
            if (accessFailure(error) && live()) revoke();
            throw error;
          }
          if (data !== payload.id)
            throw new Error(
              "Server did not confirm this report. Retry keeps the same report ID.",
            );
          return { id: data, status: "saved" as const };
        },
        {
          shouldContinue: () => mayScout() && (demo || !offlineNow()),
          onChange: () => {
            if (live()) bump((value) => value + 1);
          },
        },
      );
      if (live()) await refresh(false, true);
    } catch (error) {
      if (live()) setWriteError({ view, message: message(error) });
    } finally {
      finish(job);
      if (automatic && live()) {
        try {
          scheduleInterrupted(store.listOutbox());
        } catch {
          /* the save error is already visible */
        }
      }
    }
  };
  automaticSync.current = () => sync(true);
  const fresh =
    snapshot?.view === view &&
    live() &&
    clock - snapshot.at <= PRIVATE_SNAPSHOT_MAX_AGE_MS &&
    clock >= snapshot.at - 60_000;
  const context = fresh ? snapshot.value : null;
  const manage = async (
    action: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> => {
    if (
      !live() ||
      !activeScout(latest.current.profile) ||
      !context?.can_manage ||
      offlineNow() ||
      demo ||
      uncertain === view ||
      readError?.view === view
    )
      return false;
    const job = begin();
    if (!job) return false;
    setWriteError(null);
    // Management RPCs identify records by event and station or team target; id is a
    // reviewed-result check, not a supported request field.
    const { id: expectedId, ...fields } = payload;
    try {
      const { data, error } = await scopedPitRpc(
        "pit_scouting_manage",
        { action, p: { ...fields, event_id: eventId } },
        scoped(),
      );
      if (error) throw error;
      if (
        typeof data !== "string" ||
        !uuid.test(data) ||
        (expectedId && data !== expectedId)
      )
        throw new Error(
          "Management change was not confirmed. Refresh and review before trying again.",
        );
      if (!live()) return false;
      if (!(await refresh(false, true)) && live()) {
        setUncertain(view);
        setWriteError({
          view,
          message:
            "Your change was confirmed, but updated team data could not load. Refresh before editing again.",
        });
      }
      return live();
    } catch (error) {
      if (live()) {
        setWriteError({
          view,
          message: `${message(error)} Refresh and review before trying again.`,
        });
        setUncertain(view);
        if (accessFailure(error)) revoke();
      }
      return false;
    } finally {
      finish(job);
    }
  };
  const allowedLocal = live();
  const local = useMemo(() => {
    const result: {
      drafts: StoredScoutingDraft[];
      outbox: ScoutingOutboxRecord[];
      error: string;
      issues: ScoutingReadIssue[];
    } = { drafts: [], outbox: [], error: "", issues: [] };
    if (!store || !allowedLocal) return result;
    try {
      result.drafts = store.listDrafts();
    } catch (error) {
      result.error = message(error);
    }
    try {
      result.outbox = store.listOutbox();
    } catch (error) {
      result.error ||= message(error);
    }
    result.issues = store.getReadIssues();
    if (result.error && !result.issues.length)
      result.issues.push({ key: store.storagePrefix, message: result.error });
    return result;
  }, [store, revision, allowedLocal, clock]);
  const demoContext: ScoutingContext = {
    can_scout: mayScout(),
    can_manage: false,
    observations: local.outbox
      .filter((report) => report.status === "synced")
      .map((report) => ({
        ...report.payload,
        created_by: profile.id,
        created_at: new Date(report.syncedAt ?? report.updatedAt).toISOString(),
      })),
    assignments: [],
    picklist: [],
  };
  const expired = snapshot?.view === view && !fresh && live();
  return {
    store: allowedLocal ? store : null,
    drafts: local.drafts,
    outbox: local.outbox,
    context: demo && allowedLocal ? demoContext : context,
    updatedAt: fresh ? snapshot.at : null,
    error:
      (writeError?.view === view ? writeError.message : "") ||
      local.error ||
      storeResult.error ||
      (expired
        ? "Team scouting snapshot expired. Reconnect to refresh team data; your own device records are retained."
        : "") ||
      (readError?.view === view ? readError.message : ""),
    busy: working?.view === view,
    online,
    saveDraft,
    queue,
    sync,
    refresh,
    manage,
    canScout: mayScout(),
    managementReady:
      uncertain !== view && readError?.view !== view && !!context,
    storageIssues: local.issues,
    changed: () => bump((value) => value + 1),
    clearError: () => {
      setWriteError(null);
      setReadError(null);
    },
  };
}
