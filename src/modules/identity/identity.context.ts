// Small pieces every identity service shares.
import type { Principal } from "@/shared/rbac/principal";

export interface UserContext {
  principal: Principal;
  requestId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);
