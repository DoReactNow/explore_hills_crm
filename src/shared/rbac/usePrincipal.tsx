"use client";

// Lets UI hide or disable controls. The server stays the authority (rule 7), and UI never prints a
// permission code. Phase 0 stub: no sign-in, so without a provider can() is false for everything.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PermissionCode } from "./permissionRegistry";

const PrincipalContext = createContext<ReadonlySet<string>>(new Set());

export function PrincipalProvider({
  permissions,
  children,
}: {
  permissions: readonly PermissionCode[];
  children: ReactNode;
}) {
  const value = useMemo(() => new Set<string>(permissions), [permissions]);
  return <PrincipalContext.Provider value={value}>{children}</PrincipalContext.Provider>;
}

export function usePrincipal(): { can: (code: PermissionCode) => boolean } {
  const permissions = useContext(PrincipalContext);
  return { can: (code) => permissions.has(code) };
}
