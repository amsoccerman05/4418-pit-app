import { canWork, isAdmin, type Data, type Profile } from "../model";
import { isManualMatch, type OperationalMatch } from "./manual";
import type { Context } from "./service";
import "./crew-quick-start.css";

type Props = {
  d: Context;
  data: Data;
  profile: Profile;
  readOnly: boolean;
  scheduleStale?: boolean;
  next: OperationalMatch | null;
  open: (key: string) => void;
  go: (page: "matches" | "batteries" | "issues" | "admin") => void;
  report: () => void;
};

// This guide only opens existing workflows; their normal permission and save
// guards remain responsible for changes. Native details works without storage.
export function CrewQuickStart({
  d,
  data,
  profile,
  readOnly,
  scheduleStale = false,
  next,
  open,
  go,
  report,
}: Props) {
  const event = data.events.find((e) => e.status === "active");
  const writable = canWork(profile) && !readOnly;
  const leadership = writable && d.can_manage;
  const canAdd = event && leadership && d.manual_matches_enabled;
  const staleOfficial = next && !isManualMatch(next) && scheduleStale;

  return (
    <details className="card comp-crew-guide">
      <summary>
        <strong>Crew quick-start</strong>
        <span>Before a run · batteries · after a run</span>
      </summary>
      <div className="comp-crew-content">
        {!writable && (
          <p className="comp-crew-view-only">
            {readOnly
              ? "Read-only snapshot. Reconnect and refresh before recording work. Confirm current status with the crew."
              : "View-only access. Ask an active crew member to record checks, battery changes, and issues."}
          </p>
        )}
        <ol className="comp-crew-steps">
          <li>
            <h3>1. Before a run</h3>
            {!event ? (
              <>
                <p>
                  No active event.{" "}
                  {writable && isAdmin(profile)
                    ? "Activate an event in Event before starting."
                    : "Ask a mentor or admin to activate an event before starting."}
                </p>
                <button type="button" onClick={() => go("admin")}>
                  Open Event
                </button>
              </>
            ) : next ? (
              <>
                <p>
                  {staleOfficial
                    ? "Last loaded preparation: "
                    : "Current preparation: "}
                  <strong>{next.label}</strong>.{" "}
                  {leadership
                    ? "Start preparation, assign the battery, and complete the pre-match checklist with the crew."
                    : writable
                      ? "Leadership starts preparation and assigns the battery; complete the pre-match checklist with the crew."
                      : "Review the assigned battery and pre-match checks with the crew."}
                </p>
                {staleOfficial && (
                  <p>
                    Confirm the latest match and timing with the field crew.
                  </p>
                )}
                {isManualMatch(next) && (
                  <p>
                    This practice stays current until leadership finishes or
                    archives it. Confirm timing with the field crew.
                  </p>
                )}
                <button type="button" onClick={() => open(next.key)}>
                  {writable
                    ? "Open current preparation"
                    : "View current preparation"}
                </button>
              </>
            ) : (
              <p>
                No upcoming match or open practice.{" "}
                {canAdd
                  ? "Use Add next practice above to start preparation without an official schedule."
                  : !d.manual_matches_enabled
                    ? "Manual practice is not enabled on this server yet. Check Matches for the schedule."
                    : "Ask competition leadership to add a practice or prepare the next match."}
              </p>
            )}
          </li>
          <li>
            <h3>2. Check the real battery</h3>
            <p className="comp-crew-battery-note">
              <strong>The battery list may be incomplete.</strong> Confirm the
              physical label and status with the battery crew before use. If a
              battery is missing, ask a mentor or admin to add it.
            </p>
            <p>
              Assigning a battery does not install it.{" "}
              {writable
                ? "Record installation and removal in Batteries after the physical work."
                : "Check Batteries for the recorded status and verify it at the robot."}
            </p>
            <button type="button" onClick={() => go("batteries")}>
              Open Batteries
            </button>
          </li>
          <li>
            <h3>3. After a run</h3>
            <p>
              {d.templates.some((t) => t.active && t.kind === "post") ||
              d.runs.some((r) => r.kind === "post")
                ? "Open the finished match in Matches for its post-match inspection."
                : "Review the finished match in Matches."}{" "}
              Finishing a practice does not check off items or remove the
              battery. Tell the pit lead immediately about a robot-stopping
              problem.
            </p>
            <div className="comp-crew-actions">
              <button type="button" onClick={() => go("matches")}>
                Open Matches
              </button>
              {writable && event ? (
                <button type="button" onClick={report}>
                  Report an issue
                </button>
              ) : (
                <button type="button" onClick={() => go("issues")}>
                  View issues
                </button>
              )}
            </div>
          </li>
        </ol>
      </div>
    </details>
  );
}
