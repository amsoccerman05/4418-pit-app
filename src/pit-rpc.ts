import { supabase } from "./client";
import { boundedRequest } from "./connection";
export type PitScope = {
  actorId: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
};
// The suite broker may wait for a token twice. Pin the actor from the reviewed
// screen and cancel the request if its account/session is no longer current.
export async function scopedPitRpc(
  name: string,
  args: Record<string, unknown>,
  scope: PitScope,
) {
  return boundedRequest(async (signal) => {
    const check = () => {
      if (signal.aborted || !scope.isCurrent())
        throw new Error("Pit account changed.");
    };
    check();
    if (!supabase) throw new Error("Pit connection unavailable.");
    const { data, error } = await supabase.auth.getSession();
    check();
    if (error) throw error;
    const session = data.session;
    if (
      !session?.access_token ||
      session.user.id !== scope.actorId ||
      (session.expires_at && session.expires_at * 1000 <= Date.now())
    )
      throw Object.assign(new Error("Pit account changed."), { status: 401 });
    const result = await supabase
      .rpc(name, args)
      .setHeader("Authorization", `Bearer ${session.access_token}`)
      .abortSignal(signal);
    check();
    return result;
  }, scope.signal);
}
