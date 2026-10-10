import {
  parseMatch13,
  validateMatch13Records,
  currentTime,
  type Match13Record,
} from "./match13.ts";
export type Match13Snapshot = {
  data: Match13Record[];
  at: number | null;
  error: string | null;
};
export type CacheClaim = {
  claimed: boolean;
  token: string | null;
  event: string;
  data: unknown;
  etag: string | null;
  at: number | null;
  error: string | null;
  until: number;
};
export type Match13Store = {
  claim(event: string): Promise<CacheClaim>;
  finish(
    event: string,
    token: string,
    data: Match13Record[] | null,
    etag: string | null,
    at: number | null,
    retryAt: number,
    error: string | null,
  ): Promise<boolean>;
};
const unavailable = "Match13 backup unavailable";
export function retryDelay(value: string | null, now: number): number {
  if (!value) return 60000;
  const numeric = /^\d+(?:\.\d+)?$/.test(value.trim())
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isFinite(numeric)
    ? Math.min(
        Number.MAX_SAFE_INTEGER - now,
        Math.ceil(Math.max(60000, numeric)),
      )
    : 60000;
}
// This store is shared in Postgres across clients and Edge isolates. If its
// atomic lease fails, do not fall through to an uncached quota-consuming call.
export function createMatch13Feed(
  store: Match13Store,
  fetcher: typeof fetch = fetch,
  clock = Date.now,
) {
  return async (
    event: string,
    apiKey: string | undefined,
  ): Promise<Match13Snapshot> => {
    if (!apiKey || !/^[0-9]{4}[a-z0-9]{1,40}$/.test(event))
      return { data: [], at: null, error: unavailable };
    let claim: CacheClaim;
    try {
      claim = await store.claim(event);
    } catch {
      return { data: [], at: null, error: unavailable };
    }
    let previous: Match13Record[] | null = null;
    try {
      if (claim.event === event && claim.data !== null)
        previous = validateMatch13Records(claim.data, event);
    } catch {
      /* invalid cache cannot be served or revalidated */
    }
    const existing = (): Match13Snapshot => ({
      data: previous ?? [],
      at: previous ? claim.at : null,
      error:
        claim.error ||
        (!previous || !currentTime(claim.at, clock()) ? unavailable : null),
    });
    if (!claim.claimed || !claim.token) return existing();
    let retryAt = clock() + 60000;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
      };
      if (previous && claim.etag) headers["If-None-Match"] = claim.etag;
      const response = await fetcher(
        `https://actions.match13.com/v1/events/${encodeURIComponent(event)}/matches?scope=all`,
        { headers, signal: AbortSignal.timeout(8000), redirect: "error" },
      );
      const now = clock();
      // Retry-After is honored even on non-429 failures. Never log upstream
      // response bodies/headers, which might include a credential or HTML.
      retryAt = Math.max(
        retryAt,
        now + retryDelay(response.headers.get("retry-after"), now),
      );
      if (response.status !== 304 && !response.ok) throw new Error(unavailable);
      const data =
        response.status === 304
          ? previous
          : parseMatch13(await response.json(), event);
      if (!data) throw new Error("Missing cached response");
      const maxAge =
        Number(
          response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ??
            60,
        ) * 1000;
      retryAt = Math.max(
        retryAt,
        now + Math.max(60000, Math.min(maxAge, 86400000)),
      );
      const etag =
        response.headers.get("etag") ??
        (response.status === 304 ? claim.etag : null);
      if (
        !(await store.finish(
          event,
          claim.token,
          data,
          etag,
          now,
          retryAt,
          null,
        ))
      )
        return { data: [], at: null, error: unavailable };
      return { data, at: now, error: null };
    } catch {
      try {
        await store.finish(
          event,
          claim.token,
          null,
          null,
          null,
          retryAt,
          unavailable,
        );
      } catch {
        /* fail closed; lease still limits attempts */
      }
      return {
        data: previous ?? [],
        at: previous ? claim.at : null,
        error: unavailable,
      };
    }
  };
}
// Minimal interface keeps tests independent of the Supabase client/credentials.
export function createMatch13Store(db: {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}): Match13Store {
  return {
    async claim(event) {
      const result = await db.rpc("pit_match13_claim", { event_key: event });
      if (result.error || !result.data) throw new Error(unavailable);
      return result.data as CacheClaim;
    },
    async finish(event, token, data, etag, at, retryAt, error) {
      const result = await db.rpc("pit_match13_finish", {
        event_key: event,
        lease_token: token,
        payload: data,
        response_etag: etag,
        fetched_at: at,
        retry_at: retryAt,
        failure: error,
      });
      if (result.error) throw new Error(unavailable);
      return result.data === true;
    },
  };
}
