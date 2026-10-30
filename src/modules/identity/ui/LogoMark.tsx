import styles from "./identity.module.css";

/** The hills mark from the design system. */
export function LogoMark() {
  return (
    <span className={styles.logoMark} aria-hidden="true">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 19l6-9 4 5 3-4 5 8z" />
      </svg>
    </span>
  );
}
