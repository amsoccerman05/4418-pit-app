import { type Data, type Role, type Profile, emptyData } from "./model";
export const demoProfile = (role: Role): Profile => ({
  id: `demo-${role}`,
  display_name: `Demo ${role}`,
  role,
  active: true,
});
export function seed(): Data {
  const now = new Date().toISOString();
  const data = emptyData();
  data.profiles = (
    ["readonly", "student", "lead", "admin", "mentor"] as Role[]
  ).map(demoProfile);
  data.events = [
    {
      id: "denver",
      name: "2027 Denver Regional",
      location: "Denver, CO",
      start_date: "2027-03-25",
      end_date: "2027-03-27",
      status: "active",
      notes: "",
      created_by: "demo-admin",
      created_at: now,
      updated_at: now,
    },
  ];
  data.batteries = Array.from({ length: 10 }, (_, i) => ({
    id: `b${i + 1}`,
    battery_number: `B${String(i + 1).padStart(2, "0")}`,
    label: i === 0 ? "Competition battery" : "",
    status:
      i === 0
        ? "ON ROBOT"
        : i === 3 || i === 4
          ? "CHARGING"
          : i === 7
            ? "COOLING"
            : i === 9
              ? "FLAGGED"
              : "READY",
    notes: i === 9 ? "Inspect connector before returning to service." : "",
    active: true,
    created_at: now,
    updated_at: now,
  }));
  return data;
}
const key = "4418-pit-demo-v1";
export function readDemo(): Data {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : seed();
  } catch {
    return seed();
  }
}
export function writeDemo(data: Data) {
  localStorage.setItem(key, JSON.stringify(data));
}
