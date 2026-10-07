// Private snapshots live only in React memory. These helpers never persist data,
// grant access, queue writes, or retry mutations.
export const REQUEST_TIMEOUT_MS = 12000;
export const PIT_STALE_MS = 60000;
export const PRIVATE_SNAPSHOT_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const UNKNOWN_SAVE =
  "Save not confirmed. The request may already have completed. Refresh and review the current record before trying again.";
export const offlineNow = () =>
  typeof navigator !== "undefined" && navigator.onLine === false;
export function accessFailure(error: unknown): boolean {
  const e = error as {
    code?: string;
    status?: number;
    message?: string;
    context?: { status?: number };
  };
  return (
    e?.status === 401 ||
    e?.status === 403 ||
    e?.context?.status === 401 ||
    e?.context?.status === 403 ||
    ["42501", "PGRST301", "PGRST302", "PGRST303"].includes(e?.code || "") ||
    /jwt expired|active profile required|not authenticated|invalid jwt/i.test(
      e?.message || "",
    )
  );
}
export async function boundedRequest<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const failure = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort();
      reject(new Error("Request cancelled."));
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Connection timed out. Showing last loaded data."));
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    if (controller.signal.aborted) return await failure;
    return await Promise.race([operation(controller.signal), failure]);
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
// Query builders support abortSignal; optional chaining also keeps isolated test
// adapters and legacy read-only adapters usable.
export function abortable<T>(query: T, signal: AbortSignal): T {
  return (
    (query as T & { abortSignal?: (signal: AbortSignal) => T }).abortSignal?.(
      signal,
    ) || query
  );
}
