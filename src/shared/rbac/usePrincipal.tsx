"use client";

// Lets UI hide or disable controls. The server stays the authority (rule 7), and UI never prints a
// permission code. Without a provider, can() is false for everything.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { toFriendlyError, type FriendlyError } from "@/shared/api/friendlyError";
import type { PermissionCode } from "./permissionRegistry";

/** loading: still asking the server. signed-out: nobody. signed-in: someone, with `permissions`. */
export type SignInState = "loading" | "signed-out" | "signed-in";

const PrincipalContext = createContext<{ permissions: ReadonlySet<string>; state: SignInState }>({
  permissions: new Set(),
  state: "signed-out",
});

export function PrincipalProvider({
  permissions,
  state = "signed-in",
  children,
}: {
  permissions: readonly PermissionCode[];
  state?: SignInState;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ permissions: new Set<string>(permissions), state }),
    [permissions, state],
  );
  return <PrincipalContext.Provider value={value}>{children}</PrincipalContext.Provider>;
}

export function usePrincipal(): { can: (code: PermissionCode) => boolean; state: SignInState } {
  const { permissions, state } = useContext(PrincipalContext);
  return { can: (code) => permissions.has(code), state };
}

/** Whether a page may show itself: "loading", "allowed", or the friendly refusal to display. */
export function usePageAccess(code: PermissionCode): "loading" | "allowed" | FriendlyError {
  const { can, state } = usePrincipal();
  if (state === "loading") return "loading";
  if (state === "signed-out") return toFriendlyError({ status: 401 });
  return can(code) ? "allowed" : toFriendlyError({ status: 403 });
}
