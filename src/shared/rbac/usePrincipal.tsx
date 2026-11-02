"use client";

// Lets UI hide or disable controls. The server stays the authority (rule 7), and UI never prints a
// permission code. Without a provider, can() is false for everything.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { toFriendlyError, type FriendlyError } from "@/shared/api/friendlyError";
import type { PermissionCode } from "./permissionRegistry";

/** loading: still asking the server. signed-out: nobody. signed-in: someone, with `permissions`. */
export type SignInState = "loading" | "signed-out" | "signed-in";

interface PrincipalValue {
  permissions: ReadonlySet<string>;
  state: SignInState;
  /** Who is signed in, for greetings and per-person browser conveniences; never for access. */
  person: { id: string; name: string } | null;
}

const PrincipalContext = createContext<PrincipalValue>({
  permissions: new Set(),
  state: "signed-out",
  person: null,
});

export function PrincipalProvider({
  permissions,
  state = "signed-in",
  person = null,
  children,
}: {
  permissions: readonly PermissionCode[];
  state?: SignInState;
  person?: { id: string; name: string } | null;
  children: ReactNode;
}) {
  const personId = person?.id;
  const personName = person?.name;
  const value = useMemo(
    () => ({
      permissions: new Set<string>(permissions),
      state,
      person: personId && personName ? { id: personId, name: personName } : null,
    }),
    [permissions, state, personId, personName],
  );
  return <PrincipalContext.Provider value={value}>{children}</PrincipalContext.Provider>;
}

export function usePrincipal(): {
  can: (code: PermissionCode) => boolean;
  state: SignInState;
  person: { id: string; name: string } | null;
} {
  const { permissions, state, person } = useContext(PrincipalContext);
  return { can: (code) => permissions.has(code), state, person };
}

/** Whether a page may show itself: "loading", "allowed", or the friendly refusal to display. */
export function usePageAccess(
  code: PermissionCode | readonly PermissionCode[],
): "loading" | "allowed" | FriendlyError {
  const { can, state } = usePrincipal();
  if (state === "loading") return "loading";
  if (state === "signed-out") return toFriendlyError({ status: 401 });
  const codes = typeof code === "string" ? [code] : code;
  return codes.some(can) ? "allowed" : toFriendlyError({ status: 403 });
}
