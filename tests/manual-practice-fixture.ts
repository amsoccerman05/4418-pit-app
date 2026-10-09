import { expect, type Page } from "@playwright/test";
import { setup } from "./competition-fixture";

export const practiceId = "00000000-0000-4000-8000-000000000017";

export function practiceRecord(overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as string | undefined) || practiceId;
  return {
    id,
    event_id: "event",
    match_key: `manual:${id}`,
    source: "manual",
    manual_label: "Drive-team warmup",
    scheduled_at: null,
    finished_at: null,
    finished_by: null,
    archived_at: null,
    archived_by: null,
    battery_id: null,
    note: "",
    version: 1,
    ...overrides,
  };
}

// Extend the existing isolated browser fixture. The production client, remote
// event feed and real accounts are never used by these tests.
export async function setupManual(
  page: Page,
  options: { manager?: boolean; configured?: boolean } = {},
) {
  const fixture = await setup(page, options.manager ?? true);
  const { context, feed, calls } = fixture;
  context.manual_matches_enabled = true;
  context.templates.push({
    id: "post-template",
    name: "Practice postflight",
    description: "",
    kind: "post",
    active: true,
    version: 1,
    items: [
      {
        text: "Inspect intake after practice",
        required: true,
        blocking: false,
        area_id: null,
      },
    ],
  });
  if (options.configured === false) {
    context.config = null;
    feed.configured = false;
    feed.matches = [];
    feed.nexus = null;
  }
  const transport = {
    failNextCreate: false,
    loseNextCreateResponse: false,
    holdNextCreate: null as Promise<void> | null,
  };
  await page.route("**/fixture/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/fixture/")[1];
    if (path !== "rpc/pit_competition_manage") return route.fallback();
    const request = route.request().postDataJSON();
    const { action, p } = request;
    const record = context.matches.find((m: any) => m.id === p.match_id);
    const item = context.items.find((i: any) => i.id === p.id);
    const manualItem =
      item &&
      context.runs.some(
        (r: any) =>
          r.id === item.run_id &&
          context.matches.some(
            (m: any) => m.id === r.match_id && m.source === "manual",
          ),
      );
    if (
      !["manual_match", "finish_manual_match", "archive_manual_match"].includes(
        action,
      ) &&
      !(record?.source === "manual" && ["match", "run"].includes(action)) &&
      !(action === "item" && manualItem)
    )
      return route.fallback();
    calls.push(request);
    let result = record?.id || p.id || null;
    if (action === "manual_match") {
      if (!p.match_id) {
        if (transport.failNextCreate) {
          transport.failNextCreate = false;
          return route.abort("failed");
        }
        if (transport.holdNextCreate) {
          const pending = transport.holdNextCreate;
          transport.holdNextCreate = null;
          await pending;
        }
        let existing = context.matches.find((m: any) => m.id === p.id);
        if (!existing) {
          existing = practiceRecord({
            id: p.id,
            event_id: p.event_id,
            manual_label: p.manual_label,
            scheduled_at: p.scheduled_at || null,
          });
          context.matches.push(existing);
        }
        result = existing.id;
        if (transport.loseNextCreateResponse) {
          transport.loseNextCreateResponse = false;
          return route.abort("failed");
        }
      } else {
        Object.assign(record, {
          manual_label: p.manual_label,
          scheduled_at: p.scheduled_at || null,
          version: record.version + 1,
        });
      }
    } else if (action === "finish_manual_match") {
      Object.assign(record, {
        finished_at: new Date().toISOString(),
        finished_by: "person",
        version: record.version + 1,
      });
    } else if (action === "archive_manual_match") {
      Object.assign(record, {
        archived_at: p.archived ? new Date().toISOString() : null,
        archived_by: p.archived ? "person" : null,
        version: record.version + 1,
      });
    } else if (action === "match") {
      Object.assign(record, {
        battery_id: p.battery_id || null,
        note: p.note || "",
        version: record.version + 1,
      });
    } else if (action === "run") {
      if (!context.runs.some((r: any) => r.id === p.id)) {
        const template = context.templates.find(
          (t: any) => t.id === p.template_id,
        );
        context.runs.push({
          id: p.id,
          match_id: p.match_id,
          name: template.name,
          kind: template.kind,
          template_version: template.version,
          started_at: new Date().toISOString(),
          started_by: "person",
        });
        template.items.forEach((i: any, index: number) =>
          context.items.push({
            ...i,
            id: `${p.id}-item-${index}`,
            run_id: p.id,
            completed_at: null,
            completed_by: null,
            display_order: index,
            version: 1,
          }),
        );
      }
      result = p.id;
    } else if (action === "item") {
      Object.assign(item, {
        completed_at: p.complete ? new Date().toISOString() : null,
        completed_by: p.complete ? "person" : null,
        version: item.version + 1,
      });
      result = item.id;
    }
    await route.fulfill({ json: result });
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Competition dashboard" }),
  ).toBeVisible();
  return { ...fixture, transport };
}
