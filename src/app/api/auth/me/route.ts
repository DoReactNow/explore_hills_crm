import { identityController } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route({ access: "authenticated", handler: identityController.me });
