import { systemController } from "@/modules/system/system.controller";
import { route } from "@/shared/http/route";

export const GET = route({ access: "public", handler: systemController.health });
