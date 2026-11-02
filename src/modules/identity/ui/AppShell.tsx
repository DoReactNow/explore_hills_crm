"use client";

// The signed-in frame around every page: who you are, what you can open, and signing out. Items a
// person cannot use are removed, never greyed; counts show only where action is waiting (owner's
// design: Sidebar, NavByRole, Shell-Mobile). The server stays the authority on every action.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiRequest } from "@/shared/api/client";
import { APP_CONFIG } from "@/shared/config/appConfig";
import type { PermissionCode } from "@/shared/rbac/permissionRegistry";
import { PrincipalProvider, usePrincipal } from "@/shared/rbac/usePrincipal";
import { useLiveEvents, type LiveStatus } from "@/shared/realtime/useLiveEvents";
import { Icon, type IconName } from "@/shared/ui/Icon";
import {
  RECENT_LEADS_EVENT,
  forgetAllRecentLeads,
  readRecentLeads,
  type RecentLead,
} from "@/shared/ui/recentLeads";
import { openSearch } from "@/shared/ui/shellEvents";
import { LogoMark } from "./LogoMark";
import styles from "./identity.module.css";

const SIGN_IN_PATH = "/sign-in";
const PRIVACY_NOTICE_PATH = "/privacy-notice";
const leave = () => window.location.replace(SIGN_IN_PATH);
const COLLAPSED_KEY = "eh.sidebarCollapsed";

interface Me {
  id: string;
  name: string;
  role: { name: string };
  teamMemberships?: { team: { name: string } }[];
  permissions: PermissionCode[];
}

type CountKey = "inbox" | "queue" | "blast" | "followUps";
type Can = (code: PermissionCode) => boolean;

interface NavItem {
  key: string;
  href: string;
  label: string | ((can: Can) => string);
  icon: IconName | ((can: Can) => IconName);
  /** Admin pages sit under their own heading for people who run the system. */
  admin?: boolean;
  permission?: PermissionCode;
  anyOf?: readonly PermissionCode[];
  count?: CountKey;
}

const VIEW_LEADS = ["leads:view-own", "leads:view-team", "leads:view-all"] as const;
const seesOnlyOwn = (can: Can) => !can("dashboard:view-team") && !can("dashboard:view-all");
const leadsLabel = (can: Can) =>
  can("leads:view-all") ? "Leads" : can("leads:view-team") ? "Team leads" : "My leads";

const NAV_ITEMS: readonly NavItem[] = [
  {
    key: "dashboard",
    href: "/",
    label: (can) => (seesOnlyOwn(can) ? "My numbers" : "Dashboard"),
    icon: (can) => (seesOnlyOwn(can) ? "numbers" : "dashboard"),
  },
  { key: "leads", href: "/leads", label: leadsLabel, icon: "leads", anyOf: VIEW_LEADS },
  {
    key: "blast",
    href: "/blast",
    label: "Blast pool",
    icon: "blast",
    permission: "leads:claim",
    count: "blast",
  },
  {
    key: "inbox",
    href: "/inbox",
    label: "Inbox",
    icon: "inbox",
    permission: "messaging:view",
    count: "inbox",
  },
  {
    key: "queue",
    href: "/queue",
    label: "Queue",
    icon: "queue",
    permission: "leads:assign",
    count: "queue",
  },
  {
    key: "followups",
    href: "/follow-ups",
    label: "Follow-ups",
    icon: "followups",
    anyOf: VIEW_LEADS,
    count: "followUps",
  },
  { key: "calls", href: "/calls", label: "Calls", icon: "calls", permission: "telephony:call" },
  {
    key: "employees",
    href: "/employees",
    label: "Employees",
    icon: "employees",
    permission: "users:edit",
    admin: true,
  },
  {
    key: "teams",
    href: "/teams",
    label: (can) => (can("users:edit") ? "Teams" : "Team"),
    icon: "teams",
    permission: "teams:view",
    admin: true,
  },
  {
    key: "templates",
    href: "/templates",
    label: "Templates",
    icon: "templates",
    permission: "messaging:manage-templates",
    admin: true,
  },
  {
    key: "reports",
    href: "/reports",
    label: "Reports",
    icon: "reports",
    permission: "reports:view",
    admin: true,
  },
  {
    key: "rules",
    href: "/assignment-rules",
    label: "Assignment rules",
    icon: "rules",
    permission: "assignment:manage-rules",
    admin: true,
  },
  {
    key: "audit",
    href: "/audit",
    label: "Audit",
    icon: "audit",
    permission: "audit:view",
    admin: true,
  },
  {
    key: "privacy",
    href: "/privacy",
    label: "Customer privacy",
    icon: "privacy",
    permission: "privacy:manage",
    admin: true,
  },
  {
    key: "settings",
    href: "/settings",
    label: "Settings",
    icon: "settings",
    permission: "settings:manage",
    admin: true,
  },
  {
    key: "diagnostics",
    href: "/diagnostics",
    label: "Diagnostics",
    icon: "diagnostics",
    permission: "system:view-diagnostics",
    admin: true,
  },
  {
    key: "roles",
    href: "/roles",
    label: "Roles & Permissions",
    icon: "roles",
    permission: "roles:manage",
    admin: true,
  },
];

/** Order of the main items by who is looking (NavByRole design). Admin pages keep NAV_ITEMS order. */
const ORDER_AGENT = ["leads", "blast", "inbox", "followups", "calls", "dashboard"];
const ORDER_MANAGER = ["dashboard", "queue", "leads", "inbox", "followups", "calls", "blast"];
const ORDER_ADMIN = ["dashboard", "leads", "inbox", "queue", "followups", "calls", "blast"];

interface ResolvedItem {
  key: string;
  href: string;
  label: string;
  icon: IconName;
  admin: boolean;
  count?: CountKey;
}

function resolveNav(can: Can): { main: ResolvedItem[]; admin: ResolvedItem[] } {
  const usable = NAV_ITEMS.filter(
    (item) => (!item.permission || can(item.permission)) && (!item.anyOf || item.anyOf.some(can)),
  ).map((item) => ({
    key: item.key,
    href: item.href,
    label: typeof item.label === "function" ? item.label(can) : item.label,
    icon: typeof item.icon === "function" ? item.icon(can) : item.icon,
    admin: item.admin ?? false,
    count: item.count,
  }));
  const runsSystem = can("users:edit");
  const order = seesOnlyOwn(can) ? ORDER_AGENT : runsSystem ? ORDER_ADMIN : ORDER_MANAGER;
  const rank = (key: string) => {
    const at = order.indexOf(key);
    return at === -1 ? order.length : at;
  };
  const main = usable
    .filter((item) => !item.admin || !runsSystem)
    .sort((a, b) => Number(a.admin) - Number(b.admin) || rank(a.key) - rank(b.key));
  return { main, admin: runsSystem ? usable.filter((item) => item.admin) : [] };
}

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

const isCurrent = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

const roleLine = (me: Me) => {
  const team = me.teamMemberships?.[0]?.team.name;
  return team ? `${me.role.name} · ${team}` : me.role.name;
};

const COUNT_NOTICES = [
  "messaging.conversationChanged",
  "assignment.queueChanged",
  "assignment.poolChanged",
  "leads.leadChanged",
  "assignment.leadOwnerChanged",
];

async function countOf(path: string, pick: (data: Record<string, unknown>) => unknown) {
  const result = await apiRequest<Record<string, unknown>>(path);
  if (!result.ok || !result.data || typeof result.data !== "object") return 0;
  const value = pick(result.data);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Waiting work behind each count. Each reads the same list API its page uses, so scope matches. */
function useNavCounts(can: Can, enabled: boolean) {
  const [counts, setCounts] = useState<Record<CountKey, number>>({
    inbox: 0,
    queue: 0,
    blast: 0,
    followUps: 0,
  });
  const inbox = enabled && can("messaging:view");
  const queue = enabled && can("leads:assign");
  const blast = enabled && can("leads:claim");
  const followUps = enabled && VIEW_LEADS.some(can);
  const refresh = useCallback(async () => {
    const [inboxCount, queueCount, blastCount, followUpCount] = await Promise.all([
      inbox ? countOf("/api/conversations?unread=true&pageSize=1", (d) => d.total) : 0,
      queue ? countOf("/api/assignment/queue?pageSize=1", (d) => d.total) : 0,
      blast
        ? countOf("/api/assignment/pool", (d) => (Array.isArray(d.items) ? d.items.length : 0))
        : 0,
      followUps
        ? countOf("/api/follow-ups?bucket=today", (d) => {
            const c = d.counts as { overdue?: unknown; today?: unknown } | undefined;
            return Number(c?.overdue ?? 0) + Number(c?.today ?? 0);
          })
        : 0,
    ]);
    setCounts({
      inbox: inboxCount,
      queue: queueCount,
      blast: blastCount,
      followUps: followUpCount,
    });
  }, [inbox, queue, blast, followUps]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [enabled, refresh]);
  return { counts, refresh };
}

/** Listens for changes behind the counts, and reports whether live updates are flowing. */
function LiveCounts({
  onChange,
  onStatus,
}: {
  onChange: () => void;
  onStatus: (status: LiveStatus) => void;
}) {
  const status = useLiveEvents({ types: COUNT_NOTICES, onEvent: onChange, onResync: onChange });
  useEffect(() => onStatus(status), [status, onStatus]);
  return null;
}

function LiveBadge({ status, pill }: { status: LiveStatus; pill?: boolean }) {
  const live = status === "live";
  return (
    <span className={pill ? styles.livePill : styles.live} role="status">
      <span className={live ? styles.liveDot : styles.liveDotOff} aria-hidden="true" />
      {live ? "Live" : status === "polling" ? "Reconnecting…" : "Connecting…"}
    </span>
  );
}

function CountBadge({ value, current }: { value: number; current?: boolean }) {
  if (value <= 0) return null;
  return (
    <span className={current ? styles.countOn : styles.count} aria-label={`${value} waiting`}>
      {value > 99 ? "99+" : value}
    </span>
  );
}

function NavLinks({
  items,
  pathname,
  counts,
  collapsed,
}: {
  items: ResolvedItem[];
  pathname: string;
  counts: Record<CountKey, number>;
  collapsed: boolean;
}) {
  return items.map((item) => {
    const current = isCurrent(item.href, pathname);
    return (
      <Link
        key={item.key}
        href={item.href}
        className={styles.navLink}
        aria-current={current ? "page" : undefined}
        title={collapsed ? item.label : undefined}
      >
        <Icon name={item.icon} className={styles.navIcon} />
        <span className={styles.navLabel}>{item.label}</span>
        {item.count ? <CountBadge value={counts[item.count]} current={current} /> : null}
      </Link>
    );
  });
}

function useRecentLeads(userId: string | undefined) {
  const [recent, setRecent] = useState<RecentLead[]>([]);
  useEffect(() => {
    if (!userId) return;
    const update = () => setRecent(readRecentLeads(userId));
    const timer = setTimeout(update, 0);
    window.addEventListener(RECENT_LEADS_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(RECENT_LEADS_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [userId]);
  return recent;
}

/** The phone tab bar: up to four of the person's pages, then More (Shell-Mobile design). */
const TAB_ORDER_AGENT = ["leads", "inbox", "followups", "blast", "dashboard"];
const TAB_ORDER_OTHERS = ["dashboard", "queue", "inbox", "leads", "followups"];
const PHONE_WIDTH = "(max-width: 767px)";
const TAB_COUNT = 4;
const SHORT_LABELS: Record<string, string> = { blast: "Blast", "Roles & Permissions": "Roles" };

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
  me,
  counts,
  status,
  signingOut,
  onSignOut,
}: {
  pathname: string;
  me: Me;
  counts: Record<CountKey, number>;
  status: LiveStatus;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const { can } = usePrincipal();
  const [more, setMore] = useState(false);
  const { main, admin } = resolveNav(can);
  const usable = [...main, ...admin];
  const order = seesOnlyOwn(can) ? TAB_ORDER_AGENT : TAB_ORDER_OTHERS;
  const tabs = order
    .flatMap((key) => usable.filter((item) => item.key === key))
    .slice(0, TAB_COUNT);
  const rest = usable.filter((item) => !tabs.includes(item));
  return (
    <>
      {more ? (
        <>
          <button
            type="button"
            className={styles.moreBackdrop}
            aria-label="Close menu"
            onClick={() => setMore(false)}
          />
          <div role="dialog" aria-modal="true" aria-label="More" className={styles.moreSheet}>
            <span className={styles.grabber} aria-hidden="true" />
            <div className={styles.moreUser}>
              <span className={styles.moreAvatar} aria-hidden="true">
                {initialsOf(me.name)}
              </span>
              <span className={styles.userText}>
                <b>{me.name}</b>
                <span className={styles.userRole}>{roleLine(me)}</span>
              </span>
              <LiveBadge status={status} pill />
            </div>
            <nav aria-label="More pages" className={styles.moreGrid}>
              {rest.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={styles.moreLink}
                  onClick={() => setMore(false)}
                >
                  <Icon name={item.icon} size={24} />
                  {SHORT_LABELS[item.label] ?? item.label}
                  {item.count ? <CountBadge value={counts[item.count]} /> : null}
                </Link>
              ))}
              <Link
                href="/notifications"
                className={styles.moreLink}
                onClick={() => setMore(false)}
              >
                <Icon name="bell" size={24} />
                Notifications
              </Link>
              <button
                type="button"
                className={styles.moreLink}
                onClick={() => {
                  setMore(false);
                  openSearch();
                }}
              >
                <Icon name="search" size={24} />
                Search
              </button>
            </nav>
            <button
              type="button"
              className={styles.moreSignOut}
              disabled={signingOut}
              onClick={onSignOut}
            >
              <Icon name="signOut" size={18} strokeWidth={1.9} />
              Sign out
            </button>
          </div>
        </>
      ) : null}
      <nav aria-label="Phone" className={styles.tabBar}>
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={styles.tab}
            aria-current={!more && isCurrent(item.href, pathname) ? "page" : undefined}
            onClick={() => setMore(false)}
          >
            <span className={styles.tabIcon}>
              <Icon name={item.icon} size={22} />
              {item.count && counts[item.count] > 0 ? (
                <span className={styles.tabCount} aria-label={`${counts[item.count]} waiting`}>
                  {counts[item.count] > 99 ? "99+" : counts[item.count]}
                </span>
              ) : null}
            </span>
            {item.key === "blast" ? "Blast" : item.label}
          </Link>
        ))}
        <button
          type="button"
          className={styles.tab}
          aria-expanded={more}
          onClick={() => setMore((open) => !open)}
        >
          <span className={styles.tabIcon}>
            <Icon name="more" size={22} />
          </span>
          More
        </button>
      </nav>
    </>
  );
}

function Sidebar({
  me,
  pathname,
  counts,
  signingOut,
  onSignOut,
  hasSearch,
}: {
  me: Me | null | undefined;
  pathname: string;
  counts: Record<CountKey, number>;
  signingOut: boolean;
  onSignOut: () => void;
  hasSearch: boolean;
}) {
  const { can } = usePrincipal();
  const { main, admin } = resolveNav(can);
  const recent = useRecentLeads(me?.id);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
      } catch {
        // stays open
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const toggle = () =>
    setCollapsed((was) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, was ? "0" : "1");
      } catch {
        // a convenience only
      }
      return !was;
    });

  return (
    <nav
      aria-label="Main"
      className={collapsed ? `${styles.sidebar} ${styles.sidebarCollapsed}` : styles.sidebar}
    >
      <div className={styles.brand}>
        <LogoMark />
        <span className={styles.brandText}>{APP_CONFIG.company.legalName}</span>
        <button
          type="button"
          className={styles.collapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={16} strokeWidth={2} />
        </button>
      </div>
      {me && hasSearch ? (
        <button
          type="button"
          className={styles.searchButton}
          onClick={openSearch}
          aria-label={collapsed ? "Search leads and people" : undefined}
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Icon name="search" size={18} />
          <span className={styles.searchText}>Search leads, people…</span>
          <kbd className={styles.kbd}>⌘K</kbd>
        </button>
      ) : null}
      <div className={styles.navList}>
        <NavLinks items={main} pathname={pathname} counts={counts} collapsed={collapsed} />
        {admin.length > 0 ? (
          <>
            <div className={styles.navHeading}>Admin</div>
            <NavLinks items={admin} pathname={pathname} counts={counts} collapsed={collapsed} />
          </>
        ) : null}
      </div>
      <div className={styles.sidebarEnd}>
        {me && recent.length > 0 ? (
          <div className={styles.recent}>
            <div className={styles.recentTitle}>Recently opened</div>
            {recent.map((lead) => (
              <Link key={lead.id} href={`/leads/${lead.id}`} className={styles.recentLink}>
                {lead.destination ? `${lead.name} · ${lead.destination}` : lead.name}
              </Link>
            ))}
          </div>
        ) : null}
        {me ? (
          <div className={styles.userCard}>
            <span className={styles.avatar} aria-hidden="true">
              {initialsOf(me.name)}
            </span>
            <span className={styles.userText}>
              <span className={styles.userName}>{me.name}</span>
              <span className={styles.userRole}>{roleLine(me)}</span>
            </span>
            <button
              type="button"
              className={styles.signOut}
              aria-label="Sign out"
              disabled={signingOut}
              onClick={onSignOut}
            >
              <Icon name="signOut" size={18} />
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
  );
}

function Frame({
  me,
  pathname,
  children,
  notifications,
  search,
  signingOut,
  onSignOut,
}: {
  me: Me | null | undefined;
  pathname: string;
  children: ReactNode;
  notifications?: ReactNode;
  search?: ReactNode;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const { can } = usePrincipal();
  const phone = useIsPhone();
  const { counts, refresh } = useNavCounts(can, !!me);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [canStream, setCanStream] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setCanStream(typeof window.EventSource === "function"), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={styles.shell}>
      {me && canStream ? <LiveCounts onChange={refresh} onStatus={setStatus} /> : null}
      {phone && me ? (
        <PhoneTabs
          pathname={pathname}
          me={me}
          counts={counts}
          status={status}
          signingOut={signingOut}
          onSignOut={onSignOut}
        />
      ) : null}
      <Sidebar
        me={me}
        pathname={pathname}
        counts={counts}
        signingOut={signingOut}
        onSignOut={onSignOut}
        hasSearch={!!search}
      />
      <div className={styles.content}>
        {me ? (
          <div className={styles.topBar}>
            {canStream ? <LiveBadge status={status} /> : null}
            {notifications}
          </div>
        ) : null}
        {children}
      </div>
      {me ? search : null}
    </div>
  );
}

export function AppShell({
  children,
  notifications,
  search,
  onSignedOut = leave,
}: {
  children: ReactNode;
  /** Another module's notifications button for the top bar, for signed-in people. */
  notifications?: ReactNode;
  /** Another module's search dialog; it opens on ⌘K or OPEN_SEARCH_EVENT. */
  search?: ReactNode;
  onSignedOut?: () => void;
}) {
  const pathname = usePathname();
  const bare = pathname === SIGN_IN_PATH || pathname === PRIVACY_NOTICE_PATH;
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
    forgetAllRecentLeads();
    await apiRequest("/api/auth/sign-out", { method: "POST" });
    onSignedOut();
  }

  return (
    <PrincipalProvider
      permissions={me?.permissions ?? []}
      state={me === undefined ? "loading" : me === null ? "signed-out" : "signed-in"}
      person={me ? { id: me.id, name: me.name } : null}
    >
      <Frame
        me={me}
        pathname={pathname}
        notifications={notifications}
        search={search}
        signingOut={signingOut}
        onSignOut={signOut}
      >
        {children}
      </Frame>
    </PrincipalProvider>
  );
}
