// Reading and changing system settings. Every change is validated against the registry and audited
// with its old and new values.
import { recordAudit } from "@/modules/audit";
import { getPrisma } from "@/shared/db/prisma";
import { AppError } from "@/shared/errors";
import { assertCan } from "@/shared/rbac/assertCan";
import type { Principal } from "@/shared/rbac/principal";
import { SETTING_KEYS, SETTINGS, isSettingKey, type SettingKey } from "./system.settings";

const invalid = (message: string, field = "value") =>
  new AppError("VALIDATION_FAILED", { fieldErrors: [{ field, message }] });

/** Adds any missing setting with its default, and never touches an edited value (P3-SET-01). */
export async function ensureDefaultSettings(): Promise<void> {
  await getPrisma().systemSetting.createMany({
    data: SETTING_KEYS.map((key) => ({ key, value: SETTINGS[key].defaultValue })),
    skipDuplicates: true,
  });
}

export async function getSetting(key: SettingKey): Promise<unknown> {
  const row = await getPrisma().systemSetting.findUnique({ where: { key } });
  return row ? row.value : SETTINGS[key].defaultValue;
}

export const settingsService = {
  async listSettings(principal: Principal) {
    assertCan(principal, "settings:manage");
    const rows = await getPrisma().systemSetting.findMany();
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return SETTING_KEYS.map((key) => {
      const definition = SETTINGS[key];
      return {
        key,
        label: definition.label,
        help: definition.help,
        group: definition.group,
        value: values.get(key) ?? definition.defaultValue,
        options: "options" in definition ? definition.options : null,
      };
    });
  },

  async updateSetting(
    { principal, requestId }: { principal: Principal; requestId?: string },
    key: string,
    value: unknown,
  ) {
    assertCan(principal, "settings:manage");
    if (!isSettingKey(key)) throw invalid("That setting doesn't exist.", "key");
    const parsed = SETTINGS[key].schema.safeParse(value);
    if (!parsed.success) throw invalid("That value isn't allowed for this setting.");

    return getPrisma().$transaction(async (tx) => {
      const current = await tx.systemSetting.findUnique({ where: { key } });
      const from = current ? current.value : SETTINGS[key].defaultValue;
      if (from === parsed.data) return { key, value: from };
      const row = await tx.systemSetting.upsert({
        where: { key },
        create: { key, value: parsed.data, updatedByUserId: principal.userId },
        update: { value: parsed.data, updatedByUserId: principal.userId },
      });
      await recordAudit(tx, {
        action: "setting.updated",
        entityType: "setting",
        entityId: key,
        summary: "Setting changed",
        actor: { userId: principal.userId, roleCode: principal.roleCode },
        requestId,
        metadata: { from: from as string | number, to: parsed.data },
      });
      return { key, value: row.value };
    });
  },
};
