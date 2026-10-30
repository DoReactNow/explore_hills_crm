import { describe, expect, it, vi } from "vitest";
import { createTestClock, parseInstant } from "@/shared/time";
import { createAuditService, type AuditInput } from "../audit.service";
import type { AuditRepository, AuditTx } from "../audit.repository";
import { AUDIT_ACTIONS } from "../audit.types";

const tx = {} as AuditTx;
const NOW = "2026-10-30T10:00:00.000Z";
const valid: AuditInput = {
  action: "user.created",
  entityType: "user",
  entityId: "0190a000-0000-7000-8000-000000000001",
  summary: "User created",
  actor: { userId: "0190a000-0000-7000-8000-000000000002", roleCode: "ADMIN" },
  requestId: "req-1",
};

function setup() {
  const insert = vi.fn<AuditRepository["insert"]>(async () => undefined);
  return { insert, service: createAuditService({ insert }, createTestClock(NOW)) };
}

describe("recordAudit", () => {
  it("writes the event inside the given transaction, timed by the clock", async () => {
    const { insert, service } = setup();
    await service.recordAudit(tx, { ...valid, metadata: { roleId: "abc" } });
    expect(insert).toHaveBeenCalledWith(tx, {
      occurredAt: parseInstant(NOW),
      actorUserId: valid.actor?.userId,
      actorRoleCode: "ADMIN",
      action: "user.created",
      entityType: "user",
      entityId: valid.entityId,
      summary: "User created",
      metadata: { roleId: "abc" },
      requestId: "req-1",
    });
  });

  it("stores no user and no role for a system action (P1-AUDIT-06)", async () => {
    const { insert, service } = setup();
    await service.recordAudit(tx, { ...valid, actor: null, requestId: undefined });
    expect(insert.mock.calls[0][1]).toMatchObject({
      actorUserId: null,
      actorRoleCode: null,
      requestId: null,
      metadata: {},
    });
  });

  it.each(["entityType", "entityId", "summary"] as const)("requires %s", async (field) => {
    const { insert, service } = setup();
    await expect(service.recordAudit(tx, { ...valid, [field]: "  " })).rejects.toThrow(field);
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses an action that is not in the registry", async () => {
    const { insert, service } = setup();
    await expect(
      service.recordAudit(tx, { ...valid, action: "user.renamed" as AuditInput["action"] }),
    ).rejects.toThrow(/action/);
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ["an email", { contact: "anil@example.com" }],
    ["an email inside text", { note: "sent to anil@example.com today" }],
    ["a phone number", { contact: "+919000000001" }],
    ["a spaced phone number", { contact: "+91 90000 00001" }],
    ["a bare phone number", { contact: 9000000001 }],
    ["a phone number inside text", { note: "called 9000000001 today" }],
    ["a nested email", { after: { contact: "anil@example.com" } }],
    ["an email in a list", { contacts: ["ok", "anil@example.com"] }],
  ])("refuses metadata holding %s (P1-AUDIT-07)", async (_name, metadata) => {
    const { insert, service } = setup();
    const attempt = service.recordAudit(tx, { ...valid, metadata });
    await expect(attempt).rejects.toThrow(/metadata/);
    // The refusal is logged, so it must not repeat the personal data.
    await expect(attempt).rejects.not.toThrow(/anil@|9000000001|90000 00001/);
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ["a UUID", { id: "01234567-1234-7234-8234-123456789012" }],
    ["a date", { day: "2026-10-30" }],
    ["an instant", { at: "2026-10-30T10:00:00.000Z" }],
    ["a date and time", { at: "2026-10-30 12:05" }],
    ["a count", { count: 5 }],
    ["a flag", { locked: true }],
    ["nothing", { reason: null }],
  ])("accepts metadata holding %s", async (_name, metadata) => {
    const { insert, service } = setup();
    await service.recordAudit(tx, { ...valid, metadata });
    expect(insert).toHaveBeenCalledOnce();
  });
});

describe("AUDIT_ACTIONS", () => {
  it("lists exactly the expected actions", () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      [
        "auth.signed_in",
        "auth.signed_out",
        "auth.sign_in_failed",
        "auth.locked",
        "user.created",
        "user.updated",
        "user.role_changed",
        "user.deactivated",
        "user.reactivated",
        "user.password_changed",
        "user.manager_changed",
        "user.teams_changed",
        "team.created",
        "team.updated",
        "team.deleted",
        "team.member_added",
        "team.member_removed",
        "role.created",
        "role.updated",
        "role.permissions_changed",
        "role.deleted",
      ].sort(),
    );
  });
});
