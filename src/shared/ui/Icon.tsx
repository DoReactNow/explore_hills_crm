// The design's outline icons: 24 grid, 1.75 stroke (owner's design system, Decision 53). Icons are
// decoration; whatever they sit on carries the words, and icon-only buttons carry an aria-label.
const PATHS = {
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  leads:
    "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
  inbox: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  queue: "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z",
  employees: "M4 5h16v14H4zM9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 16a3 3 0 0 1 6 0M14 9h4M14 13h4",
  teams:
    "M17 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM21 20v-1a4 4 0 0 0-2-3.5",
  templates: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5",
  reports: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  audit: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  settings: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4",
  diagnostics: "M3 12h4l3-8 4 16 3-8h4",
  roles: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 10a2 2 0 1 0 0 .01M12 12v3",
  blast: "M13 3L4 14h7l-1 7 9-11h-7z",
  followups: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4",
  numbers: "M4 20V14M9 20V9M14 20v-4M19 20V5",
  calls:
    "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  missedCall:
    "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2zM15 3l6 6M21 3l-6 6",
  rules: "M4 7h10M4 12h16M4 17h7M17 4l3 3-3 3",
  privacy: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 9v4M12 16h.01",
  more: "M4 6h16M4 12h16M4 18h16",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01",
  signOut: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  chevronLeft: "M15 6l-6 6 6 6",
  chevronRight: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  check: "M5 12l5 5L20 7",
  close: "M6 6l12 12M18 6L6 18",
  warning: "M12 3l10 18H2zM12 10v4M12 17h.01",
  note: "M5 4h14v12l-4 4H5zM15 20v-4h4M8 9h8M8 13h5",
  filter: "M4 5h16l-6 8v6l-4-2v-4z",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  whatsapp: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM9 9.5c0 3 2.5 5.5 5.5 5.5",
  download: "M12 4v12M7 11l5 5 5-5M5 20h14",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  stage: "M5 12l5 5L20 7",
  assign:
    "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 8v6M16 11h6",
  spark: "M12 5v14M5 12h14",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.75,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
