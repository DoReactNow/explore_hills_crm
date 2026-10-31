"use client";

// The signed-in frame around every page: who you are, what you can open, and signing out. Items a
// person cannot use are removed, never greyed. The server stays the authority on every action.
import Link from "next/link";
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

const NAV_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  permission?: PermissionCode;
  anyOf?: readonly PermissionCode[];
}> = [
  { href: "/", label: "Home" },
  { href: "/inbox", label: "Inbox", permission: "messaging:view" },
  {
    href: "/leads",
    label: "Leads",
    anyOf: ["leads:view-own", "leads:view-team", "leads:view-all"],
  },
  {
    href: "/follow-ups",
    label: "Follow-ups",
    anyOf: ["leads:view-own", "leads:view-team", "leads:view-all"],
  },
  { href: "/reports", label: "Reports", permission: "reports:view" },
  { href: "/calls", label: "Calls", permission: "telephony:call" },
  { href: "/queue", label: "Queue", permission: "leads:assign" },
  { href: "/blast", label: "Blast pool", permission: "leads:claim" },
  { href: "/assignment-rules", label: "Assignment rules", permission: "assignment:manage-rules" },
  { href: "/employees", label: "Employees", permission: "users:edit" },
  { href: "/teams", label: "Teams", permission: "teams:view" },
  { href: "/templates", label: "Templates", permission: "messaging:manage-templates" },
  { href: "/settings", label: "Settings", permission: "settings:manage" },
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
      {NAV_ITEMS.filter(
        (item) =>
          (!item.permission || can(item.permission)) && (!item.anyOf || item.anyOf.some(can)),
      ).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={styles.navLink}
          aria-current={isCurrent(item.href, pathname) ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

/** The phone tab bar: the first four of these a person can open, then More (Shell-Mobile design). */
const TAB_ORDER = ["/queue", "/leads", "/inbox", "/follow-ups", "/blast"];
const PHONE_WIDTH = "(max-width: 767px)";
const TAB_COUNT = 4;

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_WIDTH);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

function PhoneTabs({
  pathname,
  name,
  role,
  signingOut,
  onSignOut,
  extra,
}: {
  extra?: ReactNode;
  pathname: string;
  name: string;
  role: string;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const { can } = usePrincipal();
  const [more, setMore] = useState(false);
  const usable = NAV_ITEMS.filter(
    (item) => (!item.permission || can(item.permission)) && (!item.anyOf || item.anyOf.some(can)),
  );
  const tabs = TAB_ORDER.flatMap((href) => usable.filter((item) => item.href === href)).slice(
    0,
    TAB_COUNT,
  );
  const rest = usable.filter((item) => !tabs.includes(item));
  return (
    <>
      {more ? (
        <div role="dialog" aria-modal="true" aria-label="More" className={styles.moreSheet}>
          <div className={styles.moreUser}>
            <b>{name}</b>
            <span>{role}</span>
          </div>
          {extra}
          <div className={styles.moreGrid}>
            {rest.map((item) => (
              <Link key={item.href} href={item.href} className={styles.moreLink}>
                {item.label}
              </Link>
            ))}
          </div>
          <button
            type="button"
            className={styles.moreSignOut}
            disabled={signingOut}
            onClick={onSignOut}
          >
            Sign out
          </button>
        </div>
      ) : null}
      <nav aria-label="Phone" className={styles.tabBar}>
        {tabs.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={styles.tab}
            aria-current={isCurrent(item.href, pathname) ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          className={styles.tab}
          aria-expanded={more}
          onClick={() => setMore((open) => !open)}
        >
          More
        </button>
      </nav>
    </>
  );
}

export function AppShell({
  children,
  navExtra,
  onSignedOut = leave,
}: {
  children: ReactNode;
  /** Another module's link in the menu, for signed-in people. */
  navExtra?: ReactNode;
  onSignedOut?: () => void;
}) {
  const pathname = usePathname();
  const bare = pathname === SIGN_IN_PATH;
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [signingOut, setSigningOut] = useState(false);
  const phone = useIsPhone();

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
        {phone && me ? (
          <PhoneTabs
            pathname={pathname}
            name={me.name}
            role={me.role.name}
            signingOut={signingOut}
            onSignOut={signOut}
            extra={navExtra}
          />
        ) : null}
        <nav aria-label="Main" className={styles.sidebar}>
          <div className={styles.brand}>
            <LogoMark />
            <span>{APP_CONFIG.company.legalName}</span>
          </div>
          <Navigation pathname={pathname} />
          {me ? navExtra : null}
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
