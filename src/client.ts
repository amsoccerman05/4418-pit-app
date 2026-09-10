import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = !!(url && key);
export let configError = "";
export const supabase = (() => {
  if (!configured) return null;
  try {
    return createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch {
    configError =
      "Invalid Supabase configuration. Check the project URL and public anon key.";
    return null;
  }
})();
