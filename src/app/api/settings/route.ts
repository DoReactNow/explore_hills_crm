import { settingsController, updateSettingSchema } from "@/modules/system/system.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "settings:manage" },
  handler: settingsController.list,
});

export const PATCH = route({
  access: { permission: "settings:manage" },
  input: updateSettingSchema,
  handler: settingsController.update,
});
