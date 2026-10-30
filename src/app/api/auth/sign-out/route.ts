import { identityController } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const POST = route({ access: "public", handler: identityController.signOut });
