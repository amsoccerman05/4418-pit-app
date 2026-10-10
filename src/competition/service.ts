import { useCallback, useEffect, useRef, useState } from "react";
import { mergeFeed, feedMatchesConfig, isStale } from "./feed-state";
import {
  abortable,
  accessFailure,
  boundedRequest,
  offlineNow,
  UNKNOWN_SAVE,
  PRIVATE_SNAPSHOT_MAX_AGE_MS,
} from "../connection";
import { supabase } from "../client";
import { scopedPitRpc, type PitScope } from "../pit-rpc";
import type { Profile } from "../model";
export {
  liveFor,
  nextMatch,
  operationalReadiness,
} from "../../supabase/functions/competition-feed/external";
export type {
  Match,
  EventMatch,
  EventTeam,
  LiveMatch,
} from "../../supabase/functions/competition-feed/external";
import type {
  Match,
  EventMatch,
  EventTeam,
  parseNexus,
} from "../../supabase/functions/competition-feed/external";
export type TemplateItem = {
  text: string;
  required: boolean;
  blocking: boolean;
  area_id: string | null;
};
export type Template = {
  id: string;
  name: string;
  description: string;
  kind: "pre" | "post" | "general";
  active: boolean;
  version: number;
  items: TemplateItem[];
};
export type Ops = {
  id: string;
  event_id: string;
  match_key: string;
  source?: "tba" | "manual";
  manual_label?: string | null;
  scheduled_at?: string | null;
  finished_at?: string | null;
  finished_by?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  battery_id: string | null;
  note: string;
  version: number;
};
export type Run = {
  id: string;
  match_id: string | null;
  name: string;
  kind: string;
  template_version: number;
  started_at: string;
  started_by: string;
};
export type Item = TemplateItem & {
  id: string;
  run_id: string;
  display_order: number;
  completed_at: string | null;
  completed_by: string | null;
  version: number;
};
export type Context = {
  manual_matches_enabled?: boolean;
  can_manage: boolean;
  config: {
    event_id: string;
    team_number: number;
    tba_event_key: string;
    nexus_event_key: string | null;
    version: number;
  } | null;
  matches: Ops[];
  templates: Template[];
  runs: Run[];
  items: Item[];
  links: { issue_id: string; match_id: string }[];
  areas: { id: string; name: string }[];
};
export type Standings = {
  scope: "qualification";
  rank: number | null;
  numTeams: number | null;
  record: { wins: number; losses: number; ties: number } | null;
};
export type Feed = {
  eventId: string | null;
  configured: boolean;
  configVersion?: number;
  team?: number;
  eventKey?: string;
  eventName?: string | null;
  matches: Match[];
  // Whole-event scouting list; absent on older feed deployments.
  scoutingMatches?: EventMatch[];
  eventTeams?: EventTeam[];
  teamsAt?: number | null;
  teamsError?: string | null;
  standings?: Standings | null;
  standingsAt?: number | null;
  standingsError?: string | null;
  standingsStale?: boolean;
  webcasts?: import("../../supabase/functions/competition-feed/webcasts").EventWebcast[];
  webcastsAt?: number | null;
  webcastsError?: string | null;
  teamEPAs?: import("../../supabase/functions/competition-feed/statbotics").TeamEPA[];
  epaAt?: number | null;
  epaError?: string | null;
  matchPredictions?: import("../../supabase/functions/competition-feed/statbotics").MatchPrediction[];
  predictionsAt?: number | null;
  predictionsError?: string | null;
  match13Predictions?: import("../../supabase/functions/competition-feed/match13").Match13Prediction[];
  match13At?: number | null;
  match13Error?: string | null;
  nexusBoard?:
    | import("../../supabase/functions/competition-feed/nexus-board").NexusBoard
    | null;
  nexusBoardAt?: number | null;
  nexusBoardError?: string | null;
  pitMap?:
    | import("../../supabase/functions/competition-feed/nexus-board").PitMap
    | null;
  pitMapAt?: number | null;
  pitMapError?: string | null;
  pitAddresses?:
    | import("../../supabase/functions/competition-feed/nexus-board").PitAddresses
    | null;
  pitAddressesAt?: number | null;
  pitAddressesError?: string | null;
  tbaAt: number | null;
  tbaError: string | null;
  nexus: ReturnType<typeof parseNexus> | null;
  nexusAt: number | null;
  nexusError: string | null;
};
export async function command(
  action: string,
  p: Record<string, unknown>,
  scope: PitScope,
) {
  const { data, error } = await scopedPitRpc(
    "pit_competition_manage",
    { action, p },
    scope,
  );
  if (error) throw error;
  return data as string;
}
export function useCompetition(
  profile: Profile | null,
  eventId: string | undefined,
  demo: boolean,
  externalVisible: boolean,
  sessionGeneration = 0,
  pitReadOnly = false,
  onAccessFailure?: () => void,
  isAuthorized?: () => boolean,
  accountSignal?: AbortSignal,
) {
  const scope = `${profile?.id || ""}:${sessionGeneration}:${eventId || ""}:${demo}`;
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    context: Context;
    at: number;
    feed: Feed | null;
  } | null>(null);
  const [readError, setReadError] = useState(""),
    [writeError, setWriteError] = useState(""),
    [feedError, setFeedError] = useState(""),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [tick, setTick] = useState(Date.now()),
    [online, setOnline] = useState(!offlineNow()),
    [uncertain, setUncertain] = useState(false);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const inflight = useRef<{
      scope: string;
      controller: AbortController;
    } | null>(null),
    saving = useRef(false),
    last = useRef(0);
  const failureHandler = useRef(onAccessFailure);
  failureHandler.current = onAccessFailure;
  const authorized = useRef(isAuthorized);
  authorized.current = isAuthorized;
  const refresh = useCallback(
    async (force = false, supersede = false) => {
      if (!profile?.id || demo || !supabase || authorized.current?.() === false)
        return false;
      if (offlineNow()) {
        setReadError("Offline. Showing last loaded competition data.");
        return false;
      }
      if (inflight.current?.scope === scope && !supersede) return false;
      inflight.current?.controller.abort();
      const request = { scope, controller: new AbortController() };
      inflight.current = request;
      setRefreshing(true);
      const valid = () =>
        currentScope.current === scope &&
        inflight.current === request &&
        !request.controller.signal.aborted &&
        authorized.current?.() !== false;
      try {
        const { data, error } = await boundedRequest(
          (signal) =>
            abortable(
              supabase!.rpc("pit_competition_context", {
                event_id: eventId || null,
              }),
              signal,
            ),
          request.controller.signal,
        );
        if (error) throw error;
        if (!valid()) return false;
        setSnapshot((previous) => ({
          scope,
          context: data,
          at: Date.now(),
          feed:
            previous?.scope === scope &&
            feedMatchesConfig(previous.feed, data?.config)
              ? previous.feed
              : null,
        }));
        setReadError("");
        if (force) {
          setWriteError("");
          setUncertain(false);
        }
        if (
          externalVisible &&
          eventId &&
          (force || Date.now() - last.current >= 30000)
        ) {
          last.current = Date.now();
          try {
            const { data: external, error: e } = await boundedRequest(
              (signal) =>
                supabase!.functions.invoke("competition-feed", {
                  body: {},
                  signal,
                }),
              request.controller.signal,
              // A cold primary timeout can be followed by the server backup.
              // Keep this bounded without cancelling a valid fallback at 12s.
              25000,
            );
            if (e) throw e;
            if (!valid()) return false;
            if (
              external?.eventId === eventId &&
              data?.config &&
              feedMatchesConfig(external, data.config)
            ) {
              setSnapshot((previous) =>
                previous?.scope === scope
                  ? { ...previous, feed: mergeFeed(previous.feed, external) }
                  : previous,
              );
              setFeedError("");
            } else
              setFeedError(
                "Event feed changed. Refresh to load the current event.",
              );
          } catch (e) {
            if (valid()) {
              if (accessFailure(e)) {
                setSnapshot(null);
                failureHandler.current?.();
              }
              setFeedError(
                "Schedule refresh failed. Showing last loaded schedule; it may be stale.",
              );
            }
          }
        }
        return true;
      } catch (e) {
        if (valid()) {
          if (accessFailure(e)) {
            setSnapshot(null);
            failureHandler.current?.();
          }
          setReadError((e as Error).message || "Competition data unavailable");
        }
        return false;
      } finally {
        if (inflight.current === request) {
          inflight.current = null;
          setRefreshing(false);
        }
      }
    },
    [profile?.id, eventId, demo, externalVisible, scope],
  );
  useEffect(() => {
    setSnapshot(null);
    setReadError("");
    setWriteError("");
    setFeedError("");
    setUncertain(false);
    setBusy(false);
    last.current = 0;
    return () => {
      inflight.current?.controller.abort();
      inflight.current = null;
      saving.current = false;
    };
  }, [scope]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      setTick(Date.now());
      if (!document.hidden) void refresh();
    }, 30000);
    const visible = () => {
      setTick(Date.now());
      if (!document.hidden) void refresh();
    };
    const reconnect = () => {
      setOnline(true);
      last.current = 0;
      void refresh();
    };
    const offline = () => {
      setOnline(false);
      setTick(Date.now());
      setReadError("Offline. Showing last loaded competition data.");
      inflight.current?.controller.abort();
      inflight.current = null;
      setRefreshing(false);
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", offline);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", offline);
    };
  }, [refresh]);
  useEffect(() => {
    if (
      snapshot?.scope === scope &&
      tick - snapshot.at > PRIVATE_SNAPSHOT_MAX_AGE_MS
    ) {
      setSnapshot(null);
      setReadError(
        "The last loaded competition snapshot expired. Reconnect and refresh.",
      );
    }
  }, [scope, snapshot, tick]);
  const scoped =
      snapshot?.scope === scope &&
      tick - snapshot.at <= PRIVATE_SNAPSHOT_MAX_AGE_MS
        ? snapshot
        : null,
    context = scoped?.context || null,
    contextAt = scoped?.at || null;
  const readOnly =
    !online ||
    pitReadOnly ||
    !!readError ||
    uncertain ||
    !context ||
    isStale(contextAt, tick, 90000);
  const run = async (action: string, p: Record<string, unknown>) => {
    if (
      !accountSignal ||
      readOnly ||
      offlineNow() ||
      authorized.current?.() === false
    )
      throw new Error("Read-only. Refresh your connection before saving.");
    if (saving.current) throw new Error("Please wait");
    saving.current = true;
    setBusy(true);
    setWriteError("");
    try {
      const id = await command(action, p, {
        actorId: profile!.id,
        signal: accountSignal,
        isCurrent: () =>
          currentScope.current === scope && authorized.current?.() !== false,
      });
      if (currentScope.current !== scope || authorized.current?.() === false)
        throw new Error("Account changed.");
      await refresh(false, true);
      if (currentScope.current !== scope || authorized.current?.() === false)
        throw new Error("Account or event changed.");
      return id;
    } catch (e) {
      if (currentScope.current === scope && authorized.current?.() !== false) {
        if (accessFailure(e)) {
          setSnapshot(null);
          failureHandler.current?.();
        }
        setUncertain(true);
        setWriteError(UNKNOWN_SAVE);
      }
      throw e;
    } finally {
      if (currentScope.current === scope) {
        saving.current = false;
        setBusy(false);
      }
    }
  };
  const scopedFeed = feedMatchesConfig(
    scoped?.feed || null,
    context?.config || null,
  )
    ? scoped!.feed
    : null;
  const liveAvailable =
    online &&
    !readError &&
    !!scopedFeed?.nexus &&
    !scopedFeed.nexusError &&
    !feedError &&
    !isStale(scopedFeed.nexus.asOf, tick, 120000) &&
    !isStale(scopedFeed.nexusAt, tick, 120000);
  return {
    context,
    contextAt,
    feed: scopedFeed,
    error: writeError || readError,
    readError,
    feedError,
    busy,
    refreshing,
    readOnly,
    online,
    refresh,
    run,
    liveAvailable,
    tick,
  };
}
export type Competition = ReturnType<typeof useCompetition>;
