"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export const EMAIL_STORAGE_KEY = "gnc_scanner_email";

// Same pattern the WHATWG HTML spec uses for <input type="email"> validation.
// Rejects consecutive/leading/trailing dots and bare domains (no TLD) that
// the old loose pattern let through.
const EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value.trim());
}

export function getStoredEmail(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(EMAIL_STORAGE_KEY);
}

export default function EmailGate({
  children,
}: {
  children: React.ReactNode;
}) {
  // null = still checking localStorage, "" = checked & none found
  const [storedEmail, setStoredEmail] = useState<string | null | undefined>(
    undefined,
  );
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setStoredEmail(getStoredEmail() ?? "");
  }, []);

  const trimmed = email.trim();
  const valid = isValidEmail(trimmed);
  const showError = touched && trimmed.length > 0 && !valid;
  const isEmpty = trimmed.length === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    window.localStorage.setItem(EMAIL_STORAGE_KEY, trimmed);
    setStoredEmail(trimmed);
  };

  // Still reading localStorage - render nothing to avoid a gate flash.
  if (storedEmail === undefined) return null;

  if (storedEmail) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Image
            src="/gnc-logo.png"
            alt="GNC - Live Well"
            width={140}
            height={79}
            priority
            className="h-14 w-auto"
          />
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <h1 className="font-display text-xl font-semibold uppercase tracking-wide text-foreground">
            Before You Scan
          </h1>
          <p className="mt-2 text-sm text-muted">
            Enter your email so we can save your scan session and send order
            updates. We&apos;ll remember it on this device.
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-2">
            <label
              htmlFor="gate-email"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted"
            >
              Email address
            </label>
            <input
              id="gate-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={showError}
              aria-describedby={showError ? "gate-email-error" : undefined}
              className={`w-full rounded-lg border bg-surface-2 px-3 py-3 text-sm text-foreground placeholder:text-muted/60 outline-none transition ${
                showError
                  ? "border-brand focus:border-brand"
                  : "border-line focus:border-brand"
              }`}
            />
            {showError && (
              <p id="gate-email-error" className="text-xs text-brand">
                Enter a valid email address (e.g. you@example.com).
              </p>
            )}

            <button
              type="submit"
              disabled={isEmpty || !valid}
              className="!mt-6 w-full rounded-full bg-brand py-3.5 font-display text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted"
            >
              Continue to Scanner
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted/60">
          Your email stays on this device and is never uploaded.
        </p>
      </div>
    </div>
  );
}
