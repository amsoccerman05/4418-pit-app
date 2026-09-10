// Read-only queries and RPC permission probes with empty (non-insertable) payloads.
// No seed records, privileged keys, user creation, or role changes.
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.local");
if (existsSync(".env.live-test")) process.loadEnvFile(".env.live-test");
const url = process.env.VITE_SUPABASE_URL,
  key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error("Missing public Supabase configuration");
if (!key.startsWith("sb_publishable_")) {
  const payload = JSON.parse(
    Buffer.from(key.split(".")[1] || "", "base64url").toString(),
  );
  if (payload.role !== "anon")
    throw new Error("Only a public anon/publishable key is permitted");
}
const tables = [
  "pit_events",
  "pit_issues",
  "pit_batteries",
  "pit_battery_events",
  "pit_issue_events",
];
const rpcs = [
  "pit_report_issue",
  "pit_update_issue",
  "pit_transition_battery",
  "pit_save_battery",
  "pit_save_event",
  "pit_activate_event",
];
const client = () =>
  createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
const mustDeny = (error, label) => {
  if (error?.code !== "42501")
    throw new Error(
      `${label}: expected permission denial, received ${error?.code || "success"}`,
    );
  console.log(`PASS ${label}`);
};
const anon = client();
for (const table of tables) {
  const { error } = await anon.from(table).select("id").limit(0);
  mustDeny(error, `anonymous read ${table}`);
}
for (const rpc of rpcs) {
  const { error } = await anon.rpc(rpc, { p: {} });
  mustDeny(error, `anonymous RPC ${rpc}`);
}
let verified = 0;
for (const role of ["readonly", "student", "lead", "admin", "mentor"]) {
  const prefix = `PIT_TEST_${role.toUpperCase()}`;
  const email = process.env[`${prefix}_EMAIL`],
    password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) {
    console.log(`NOT TESTED ${role}: local test credentials absent`);
    continue;
  }
  const c = client();
  try {
    const { data: auth, error: loginError } = await c.auth.signInWithPassword({
      email,
      password,
    });
    if (loginError)
      throw new Error(
        `${role}: sign-in failed (${loginError.code || loginError.status})`,
      );
    const { data: profile, error } = await c
      .from("profiles")
      .select("id,role,active")
      .eq("id", auth.user.id)
      .single();
    if (error || !profile?.active || profile.role !== role)
      throw new Error(
        `${role}: shared active profile does not match expected role`,
      );
    console.log(
      `PASS ${role}: signed-in user's existing shared profile matches`,
    );
    for (const table of tables) {
      const { error } = await c.from(table).select("id").limit(0);
      if (error)
        throw new Error(`${role}: ${table} read failed (${error.code})`);
    }
    const denied =
      role === "readonly"
        ? rpcs
        : role === "student"
          ? [
              "pit_update_issue",
              "pit_save_battery",
              "pit_save_event",
              "pit_activate_event",
            ]
          : role === "lead"
            ? ["pit_save_battery", "pit_save_event", "pit_activate_event"]
            : [];
    for (const rpc of denied) {
      const { error } = await c.rpc(rpc, { p: {} });
      mustDeny(error, `${role} RPC ${rpc}`);
    }
    verified++;
  } finally {
    await c.auth.signOut({ scope: "local" });
    await c.removeAllChannels();
  }
}
console.log(
  `Authenticated roles checked: ${verified}/5. Successful writes and cross-client realtime delivery require a separate live smoke test.`,
);
