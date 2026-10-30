"use client";

// The signed-in frame around every page: who you are, what you can open, and signing out. Items a
// person cannot use are removed, never greyed. The server stays the authority on every action.
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { apiRequest } from "@/shared/api/client";
import { APP_CONFIG } from "@/shared/config/appConfig";
import type { PermissionCode } from "@/shared/rbac/permissionRegistry";
import { PrincipalProvider, usePrincipal } from "@/shared/rbac/usePrincipal";
import { LogoMark } from "./LogoMark";
import styles from "./identity.module.css";

const SIGN_IN_PATH = "/sign-in";
const leave = () => window.location.replace(SIGN_IN_PATH);

interface Me {
  name: string;
  role: { name: string };
  permissions: PermissionCode[];
}

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string; permission?: PermissionCode }> = [
  { href: "/", label: "Home" },
  { href: "/employees", label: "Employees", permission: "users:edit" },
  { href: "/teams", label: "Teams", permission: "teams:view" },
  { href: "/diagnostics", label: "Diagnostics", permission: "system:view-diagnostics" },
  { href: "/roles", label: "Roles & Permissions", permission: "roles:manage" },
];

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

const isCurrent = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

function Navigation({ pathname }: { pathname: string }) {
  const { can } = usePrincipal();
  return (
    <div className={styles.navList}>
      {NAV_ITEMS.filter((item) => !item.permission || can(item.permission)).map((item) => (
        <a
          key={item.href}
          href={item.href}
          className={styles.navLink}
          aria-current={isCurrent(item.href, pathname) ? "page" : undefined}
        >
          {item.label}
        </a>
      ))}
    </div>
  );
}

export function AppShell({
  children,
  onSignedOut = leave,
}: {
  children: ReactNode;
  onSignedOut?: () => void;
}) {
  const pathname = usePathname();
  const bare = pathname === SIGN_IN_PATH;
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (bare) return;
    const controller = new AbortController();
    apiRequest<Me>("/api/auth/me", { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setMe(result.ok ? result.data : null);
    });
    return () => controller.abort();
  }, [bare]);

  // Back after signing out can restore a page from the browser's memory, data included; reloading
  // asks the server again, which refuses (P1-SESSION-11).
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  if (bare) return <>{children}</>;

  async function signOut() {
    setSigningOut(true);
    await apiRequest("/api/auth/sign-out", { method: "POST" });
    onSignedOut();
  }

  return (
    <PrincipalProvider
      permissions={me?.permissions ?? []}
      state={me === undefined ? "loading" : me === null ? "signed-out" : "signed-in"}
    >
      <div className={styles.shell}>
        <nav aria-label="Main" className={styles.sidebar}>
          <div className={styles.brand}>
            <LogoMark />
            <span>{APP_CONFIG.company.legalName}</span>
          </div>
          <Navigation pathname={pathname} />
          <div className={styles.sidebarEnd}>
            {me ? (
              <div className={styles.userCard}>
                <span className={styles.avatar} aria-hidden="true">
                  {initialsOf(me.name)}
                </span>
                <span className={styles.userText}>
                  <span className={styles.userName}>{me.name}</span>
                  <span className={styles.userRole}>{me.role.name}</span>
                </span>
                <button
                  type="button"
                  className={styles.signOut}
                  aria-label="Sign out"
                  disabled={signingOut}
                  onClick={signOut}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
                  </svg>
                </button>
              </div>
            ) : null}
            {me === null ? (
              <a
                className={styles.signInLink}
                href={`${SIGN_IN_PATH}?next=${encodeURIComponent(pathname)}`}
              >
                Sign in
              </a>
            ) : null}
          </div>
        </nav>
        <div className={styles.content}>{children}</div>
      </div>
    </PrincipalProvider>
  );
}
