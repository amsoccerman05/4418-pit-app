# Repair purchasing: staged first slice

Base: Competition Operations main `82195caaf89b57d6127faa5bc28174e34ac8fdbf`.

## User workflow

An existing repair shows only purchase orders the signed-in person is already allowed to view in Finance. A repair manager can paste an exact Finance PO link or UUID, preview its number/status/requester, enter a reason, and explicitly link it. The server additionally requires the PO requester or an existing Finance administrator. Opening or previewing never saves anything.

A PO requester is not necessarily a buyer. “Submitted to school” is the existing Finance workflow state, not evidence of ordering, shipment, receipt, or installation. Links never change repair status, robot readiness, purchase approvals, budget values, or inventory. Several existing POs can support one repair. The initial bridge preserves immutable links; removal/correction is a later reviewed capability.

## Integration

This UI depends on the separately staged Finance migration `20261005235435_finance_repair_po_links.sql`. It must not be applied automatically. Missing RPCs show an isolated unavailable state; existing repairs keep working.

- `finance_repair_context({p_issue_id})`: minimal authorized linked PO summaries.
- `finance_repair_po_candidate({p_issue_id,p_po_id})`: one authorized preview and per-PO attach capability.
- `finance_attach_repair_po({p_issue_id,p_po_id,p_expected_issue_updated_at,p_reason})`: explicit immutable attachment; returns updated authorized context.

The frontend validates response shape and matching IDs. It sends the timestamp of the repair actually shown to the user, and refuses a preview that silently advances that stamp. Unknown mutation outcomes are not retried; refresh links before trying again. The database unique pair makes an explicitly repeated attachment a no-op while preserving the first actor/reason/time.

The server stores relationship audit data privately. It must not expose hidden PO counts, vendor, amount, requester, or status through a broad Pit feed. The UI does not read Finance tables directly and uses no privileged key.

## Repair links

`https://pit.frc4418.org/#issue/{UUID}` opens a repair only from the caller's already-authorized loaded records. Invalid/unavailable links show a generic message. Dismissal clears the route so periodic refresh cannot reopen it. Navigating a link performs no mutation. Existing authentication is unchanged; after signing in through the existing gateway, reopen the original repair link if needed.

## Validation and release gate

Build/typecheck and existing plus added non-browser tests pass locally. Tests cover strict PO URL parsing, malformed/mismatched responses, no auto-retry, exact RPC arguments, demo isolation, and safe workflow labels. Fixture browser tests cover explicit review, role gating, unavailable bridge, uncertain save, stale repair preview, phone layout, and route dismissal/unavailable records.

Browser execution/visual inspection remains pending because this environment cannot launch Chromium. Independent source review also checks delayed operations and React StrictMode replay. Do not claim browser tests passed.

Keep this UI and the Finance bridge staged until migration review and release approval. Before release, rerun both repositories' complete checks on exact heads, test the bridge in an approved isolated database, verify least-privilege behavior and rollback, then use the existing deployment workflow. No production invitations, notifications, records, settings, or migrations were changed during implementation.

## Deferred

Creating a new PO from a repair needs an atomic, idempotent create-and-link RPC through the existing Finance budget-aware mutation and form validation. It is not part of this initial existing-PO link. Inventory receiving, automated purchasing, repair resolution, and persisted notifications are also outside this slice.
