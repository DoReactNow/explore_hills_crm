"use client";

// The sign-in form. Every message comes from the friendly error mapper; the server's text is never
// shown. No "keep me signed in" and no lockout countdown (Decision 53).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import styles from "./identity.module.css";

const SLOW_AFTER_MS = 10_000;

const goTo = (path: string) => window.location.assign(path);

export function SignInForm({
  next,
  onSignedIn = goTo,
}: {
  next: string;
  onSignedIn?: (path: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!submitting) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [submitting]);

  const fieldMessage = (field: string) =>
    error?.fieldErrors?.find((item) => item.field === field)?.message;
  const emailMessage = fieldMessage("email");
  const passwordMessage = fieldMessage("password");
  const showBanner = error !== null && !emailMessage && !passwordMessage;
  const wrongPassword = error?.code === "INVALID_CREDENTIALS";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await apiRequest("/api/auth/sign-in", {
      method: "POST",
      body: { email, password },
    });
    if (result.ok) {
      onSignedIn(next);
      return;
    }
    setSubmitting(false);
    setError(result.error);
    passwordInput.current?.focus();
  }

  return (
    <form className={styles.card} onSubmit={submit} noValidate>
      {showBanner ? (
        <div role="alert" className={styles.alert}>
          {error.message}
        </div>
      ) : null}

      <div className={styles.field}>
        <label htmlFor="sign-in-email">Work email</label>
        <input
          id="sign-in-email"
          type="email"
          autoComplete="username"
          className={styles.input}
          aria-invalid={Boolean(emailMessage)}
          aria-describedby={emailMessage ? "sign-in-email-message" : undefined}
          value={email}
          readOnly={submitting}
          onChange={(event) => setEmail(event.target.value)}
        />
        {emailMessage ? (
          <span id="sign-in-email-message" className={styles.fieldError}>
            {emailMessage}
          </span>
        ) : null}
      </div>

      <div className={styles.field}>
        <label htmlFor="sign-in-password">Password</label>
        <div className={styles.passwordRow}>
          <input
            id="sign-in-password"
            ref={passwordInput}
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className={styles.input}
            aria-invalid={Boolean(passwordMessage) || wrongPassword}
            aria-describedby={
              passwordMessage || wrongPassword ? "sign-in-password-message" : undefined
            }
            value={password}
            readOnly={submitting}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className={styles.showPassword}
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        {passwordMessage || wrongPassword ? (
          <span id="sign-in-password-message" className={styles.fieldError}>
            {passwordMessage ?? "Passwords are case-sensitive. Is Caps Lock on?"}
          </span>
        ) : null}
      </div>

      <button type="submit" className={styles.submit} disabled={submitting} aria-busy={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>
      {slow ? <p className={styles.hint}>Still working — your connection seems slow.</p> : null}
      <p className={styles.hint}>Forgot your password? Ask your admin.</p>
    </form>
  );
}
