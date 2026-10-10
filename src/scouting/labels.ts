import { label } from "./model";
// Presentation only: existing schema values and unknown/null semantics stay intact.
const unset: Record<string, string> = {
  alliance: "Choose alliance",
  start_position: "Start unseen / unsure",
  auto_climb: "Choose climb result",
  endgame: "Choose climb result",
  accuracy: "Accuracy unknown",
  role: "Choose main role",
  traversal: "Traversal unknown",
  intake: "Intake source unknown",
  drive: "Drivetrain unknown",
  climb: "Climb capability unknown",
};
export const fieldHelp: Record<string, string> = {
  alliance: "Red or blue alliance for the robot you are watching.",
  start_position:
    "Where the robot started AUTO. Leave unsure if you missed the start.",
  auto_climb:
    "Did not attempt means no climb was tried. Failed means it tried but did not finish. Leave unknown if you could not tell.",
  endgame:
    "Choose the highest level reached. No attempt and a failed attempt are different results.",
  accuracy:
    "Estimate the share of attempted shots that went in. Leave unknown if you could not judge.",
  role: "What the robot spent most of this match doing.",
  traversal:
    "Which field routes you saw it use. None means you saw it use neither route.",
  intake: "Where it collected fuel. Neither means you saw no fuel collection.",
};
export function optionLabel(field: string, value: string): string {
  if (value === "unknown") return unset[field] || "Unknown / not recorded";
  if (field === "auto_climb" || field === "endgame")
    return (
      (
        {
          not_attempted: "Did not attempt a climb",
          failed: "Attempted, but failed",
          succeeded: "Climbed successfully",
          L1: "Reached Level 1",
          L2: "Reached Level 2",
          L3: "Reached Level 3",
        } as Record<string, string>
      )[value] || label(value)
    );
  if (field === "start_position")
    return (
      (
        { trench: "Trench side", bump: "Bump side", hub: "Hub side" } as Record<
          string,
          string
        >
      )[value] || label(value)
    );
  return label(value);
}
export function ratingLabel(field: string, value: number): string {
  const labels =
    field === "defense"
      ? [
          "Little impact",
          "Some disruption",
          "Slowed opponent",
          "Often stopped cycles",
          "Very effective defense",
        ]
      : [
          "Struggled with control",
          "Inconsistent control",
          "Steady driving",
          "Fast and controlled",
          "Excellent precision",
        ];
  return `${value} · ${labels[value - 1] || "Not rated"}`;
}
