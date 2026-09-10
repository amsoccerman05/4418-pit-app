import { test } from "node:test";
import assert from "node:assert/strict";
import { readiness, unresolved, batteryMatch } from "../src/model.ts";
test("readiness derives from unresolved severity and keeps deferred blockers", () => {
  assert.equal(readiness([]), "READY");
  assert.equal(readiness([{ severity: "LOW", status: "OPEN" }]), "READY");
  assert.equal(
    readiness([{ severity: "HIGH", status: "TESTING" }]),
    "NEEDS ATTENTION",
  );
  assert.equal(
    readiness([
      { severity: "HIGH", status: "OPEN" },
      { severity: "ROBOT DOWN", status: "REPAIRING" },
    ]),
    "NOT READY",
  );
  assert.equal(
    readiness([{ severity: "ROBOT DOWN", status: "DEFERRED" }]),
    "NOT READY",
  );
  assert.equal(
    readiness([{ severity: "HIGH", status: "DEFERRED" }]),
    "NEEDS ATTENTION",
  );
  assert.equal(
    readiness([{ severity: "ROBOT DOWN", status: "RESOLVED" }]),
    "READY",
  );
  assert.equal(unresolved({ status: "DEFERRED" }), true);
});

test("match labels follow the latest usage cycle rather than measurements or older matches", () => {
  const e = (
    from_status,
    to_status,
    match_number,
    created_at,
    event_type = "status_changed",
  ) => ({
    battery_id: "b7",
    from_status,
    to_status,
    match_number,
    created_at,
    event_type,
  });
  const installed = e("READY", "ON ROBOT", "Q42", "2027-03-25T10:00:00Z");
  const removed = e("ON ROBOT", "COOLING", "", "2027-03-25T10:10:00Z");
  const charged = e("CHARGING", "READY", "", "2027-03-25T10:30:00Z");
  const b = { id: "b7", status: "ON ROBOT" };
  assert.equal(batteryMatch(b, [installed]), "Q42");
  assert.equal(
    batteryMatch({ ...b, status: "COOLING" }, [installed, removed]),
    "Q42",
  );
  assert.equal(
    batteryMatch({ ...b, status: "READY" }, [installed, removed, charged]),
    "Q42",
  );
  const next = e("READY", "ON ROBOT", "", "2027-03-25T10:40:00Z");
  assert.equal(batteryMatch(b, [installed, removed, charged, next]), "");
  assert.equal(
    batteryMatch({ ...b, status: "FLAGGED" }, [
      installed,
      removed,
      charged,
      next,
      e("ON ROBOT", "FLAGGED", "F2", "2027-03-25T10:50:00Z"),
    ]),
    "F2",
  );
  assert.equal(
    batteryMatch({ ...b, status: "COOLING" }, [
      installed,
      removed,
      charged,
      next,
      e("ON ROBOT", "COOLING", "", "2027-03-25T10:50:00Z"),
    ]),
    "",
  );
  assert.equal(
    batteryMatch(b, [
      installed,
      e("ON ROBOT", "ON ROBOT", "Other", "2027-03-25T10:05:00Z", "measurement"),
    ]),
    "Q42",
  );
  assert.equal(
    batteryMatch({ id: "b8", status: "READY" }, [installed, removed]),
    "",
  );
});
