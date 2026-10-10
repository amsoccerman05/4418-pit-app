import { useRef, useState } from "react";
import type { Context, Ops } from "./service";
import type { Profile } from "../model";

type Act = (
  action: string,
  p: Record<string, unknown>,
  done?: (id: string) => void,
) => void;
function localInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function PracticeEditor({
  ops,
  initialLabel = "",
  eventId,
  d,
  busy,
  save,
  cancel,
}: {
  ops?: Ops;
  initialLabel?: string;
  eventId: string;
  d: Context;
  busy: boolean;
  save: (p: Record<string, unknown>) => void;
  cancel: () => void;
}) {
  // Preserve the creation request ID through unknown responses and explicit retry.
  const [id] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  return (
    <form
      className="card comp-practice-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        const f = new FormData(e.currentTarget),
          label = String(f.get("label") || "").trim(),
          time = String(f.get("scheduled") || "");
        if (!label) {
          setError("Enter a practice label.");
          return;
        }
        if (
          d.matches.some(
            (m) =>
              m.source === "manual" &&
              !m.archived_at &&
              m.id !== (ops?.id || id) &&
              m.manual_label?.trim().replace(/\s+/g, " ").toLowerCase() ===
                label.replace(/\s+/g, " ").toLowerCase(),
          )
        ) {
          setError(
            "A practice with that label already exists. Open it or choose a different label.",
          );
          return;
        }
        const date = time ? new Date(time) : null;
        if (date && !Number.isFinite(date.getTime())) {
          setError("Choose a valid scheduled start.");
          return;
        }
        setError("");
        save({
          ...(ops
            ? { match_id: ops.id, version: ops.version }
            : { id, event_id: eventId }),
          manual_label: label,
          scheduled_at: date?.toISOString() || null,
        });
      }}
    >
      <h3>{ops ? "Edit practice" : "Add practice match"}</h3>
      <label>
        Practice label
        <input
          name="label"
          autoFocus
          required
          maxLength={80}
          placeholder="Practice 1"
          defaultValue={ops?.manual_label || initialLabel}
        />
      </label>
      <label>
        Scheduled start (optional)
        <input
          name="scheduled"
          type="datetime-local"
          defaultValue={localInput(ops?.scheduled_at)}
        />
      </label>
      <small>
        Time uses this device’s local time zone. Leave blank if the field crew
        hasn’t assigned a time.
      </small>
      <p>
        Open practices stay the dashboard preparation target until finished or
        archived. Official matches remain in their own list.
      </p>
      {!ops && (
        <p>
          This is a new practice. Start fresh checklists from your templates
          after saving. Previous checks, battery assignment, notes and start
          time are not copied; earlier inspections stay on their own practice.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="comp-inline">
        <button className="primary" disabled={busy}>
          {ops ? "Save practice" : "Add practice"}
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
export function PracticeControls({
  ops,
  d,
  eventId,
  busy,
  act,
  profiles,
}: {
  ops: Ops;
  d: Context;
  eventId: string;
  busy: boolean;
  act: Act;
  profiles: Profile[];
}) {
  const [editing, setEditing] = useState(false),
    [confirm, setConfirm] = useState<{
      kind: "finish" | "archive";
      version: number;
    } | null>(null);
  const editGeneration = useRef(0);
  const edit = (value: boolean) => {
    editGeneration.current++;
    setEditing(value);
    setConfirm(null);
  };
  const actor = (id?: string | null) =>
    profiles.find((p) => p.id === id)?.display_name || "Team member";
  return (
    <>
      <p>
        <span className="badge info">Manual</span> ·{" "}
        {ops.archived_at
          ? "Archived"
          : ops.finished_at
            ? "Finished"
            : "Upcoming practice"}
      </p>
      <p>
        {ops.scheduled_at
          ? `Scheduled ${new Date(ops.scheduled_at).toLocaleString()}`
          : "No scheduled start time"}
      </p>
      {ops.finished_at && (
        <p>
          Finished by {actor(ops.finished_by)} ·{" "}
          {new Date(ops.finished_at).toLocaleString()}
        </p>
      )}
      {ops.archived_at && (
        <p>
          Archived by {actor(ops.archived_by)} ·{" "}
          {new Date(ops.archived_at).toLocaleString()}. Checklist history is
          retained.
        </p>
      )}
      {d.can_manage && (
        <>
          {editing && (
            <PracticeEditor
              key={ops.id + ":" + ops.version}
              ops={ops}
              eventId={eventId}
              d={d}
              busy={busy}
              cancel={() => edit(false)}
              save={(p) => {
                const generation = editGeneration.current;
                act("manual_match", p, () => {
                  if (generation === editGeneration.current) edit(false);
                });
              }}
            />
          )}
          {!editing && (
            <div className="comp-inline">
              {!ops.archived_at && (
                <button disabled={busy} onClick={() => edit(true)}>
                  Edit practice
                </button>
              )}
              {!ops.archived_at && !ops.finished_at && (
                <button
                  disabled={busy}
                  onClick={() =>
                    setConfirm({ kind: "finish", version: ops.version })
                  }
                >
                  Finish practice
                </button>
              )}
              {ops.archived_at ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    act("archive_manual_match", {
                      match_id: ops.id,
                      version: ops.version,
                      archived: false,
                    })
                  }
                >
                  Restore practice
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() =>
                    setConfirm({ kind: "archive", version: ops.version })
                  }
                >
                  Archive practice
                </button>
              )}
            </div>
          )}
          {confirm && (
            <div
              className="card"
              role="group"
              aria-label={
                confirm.kind === "finish"
                  ? "Confirm practice finished"
                  : "Confirm practice archive"
              }
            >
              <p>
                {confirm.kind === "finish"
                  ? d.templates.some((t) => t.active && t.kind === "post")
                    ? "Mark this practice finished and open post-match inspection? Checklists and battery status still need to be recorded by the crew."
                    : "Mark this practice finished? This does not change battery status."
                  : "Hide this practice from the active list? Existing checklists, issues and unfinished inspections remain available and still count toward readiness."}
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  act(
                    confirm.kind === "finish"
                      ? "finish_manual_match"
                      : "archive_manual_match",
                    {
                      match_id: ops.id,
                      version: confirm.version,
                      ...(confirm.kind === "archive" ? { archived: true } : {}),
                    },
                    () => setConfirm(null),
                  )
                }
              >
                {confirm.kind === "finish"
                  ? "Confirm finished"
                  : "Confirm archive"}
              </button>
              <button onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          )}
        </>
      )}
    </>
  );
}
