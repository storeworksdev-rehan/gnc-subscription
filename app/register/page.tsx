"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getStoredEmail, isValidEmail } from "@/components/EmailGate";
import { formatPrice, type PurchaseType } from "@/lib/products";

type RegisterInfo = {
  code: string;
  name: string;
  price: number;
  type: PurchaseType;
};

export default function RegisterPage() {
  const [info, setInfo] = useState<RegisterInfo | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const price = Number(params.get("price"));
    setInfo({
      code: params.get("code") ?? "",
      name: params.get("name") ?? "Selected Product",
      price: Number.isFinite(price) ? price : 0,
      type: params.get("type") === "subscription" ? "subscription" : "one-time",
    });
    setEmail(params.get("email") ?? getStoredEmail() ?? "");
  }, []);

  const emailInvalid = touched && email.trim().length > 0 && !isValidEmail(email);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!fullName.trim() || !isValidEmail(email)) return;
    setSubmitted(true);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b-2 border-brand bg-black">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between px-4 py-4">
          <Image
            src="/gnc-logo.png"
            alt="GNC - Live Well"
            width={100}
            height={56}
            priority
            className="h-10 w-auto"
          />
          <Link
            href="/"
            className="text-[11px] uppercase tracking-[0.2em] text-muted transition hover:text-brand"
          >
            &larr; Back to Scanner
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-10">
        {submitted ? (
          <div className="rounded-2xl border border-line bg-surface p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand/15">
              <svg
                className="h-7 w-7 text-brand"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="font-display text-xl font-semibold uppercase text-foreground">
              You&apos;re All Set
            </h1>
            <p className="mt-2 text-sm text-muted">
              {info?.type === "subscription"
                ? "Your subscription request"
                : "Your registration"}{" "}
              for <span className="text-foreground">{info?.name}</span> has
              been received.
            </p>
            <Link
              href="/"
              className="mt-6 inline-block rounded-full bg-brand px-6 py-3 font-display text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-brand-dark"
            >
              Back to Scanner
            </Link>
          </div>
        ) : (
          <>
            <h1 className="font-display text-2xl font-semibold uppercase tracking-wide text-foreground">
              Complete Your <span className="text-brand">Registration</span>
            </h1>
            <p className="mt-1 text-sm text-muted">
              Finish signing up to unlock this item.
            </p>

            {info && info.code && (
              <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
                <p className="font-display text-base font-semibold text-foreground">
                  {info.name}
                </p>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-muted">Product Code</span>
                  <span className="font-mono text-foreground">{info.code}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-muted">Plan</span>
                  <span className="text-foreground">
                    {info.type === "subscription"
                      ? "Subscribe & Save"
                      : "One-Time Purchase"}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-muted">Price</span>
                  <span className="font-display font-semibold text-brand">
                    {formatPrice(info.price)}
                  </span>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="reg-name"
                  className="text-[11px] font-semibold uppercase tracking-wider text-muted"
                >
                  Full name
                </label>
                <input
                  id="reg-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onBlur={() => setTouched(true)}
                  placeholder="Jane Doe"
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-3 text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-brand"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="reg-email"
                  className="text-[11px] font-semibold uppercase tracking-wider text-muted"
                >
                  Email address
                </label>
                <input
                  id="reg-email"
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched(true)}
                  placeholder="you@example.com"
                  aria-invalid={emailInvalid}
                  className={`w-full rounded-lg border bg-surface-2 px-3 py-3 text-sm text-foreground placeholder:text-muted/60 outline-none transition ${
                    emailInvalid
                      ? "border-brand focus:border-brand"
                      : "border-line focus:border-brand"
                  }`}
                />
                {emailInvalid && (
                  <p className="text-xs text-brand">
                    Enter a valid email address.
                  </p>
                )}
              </div>
              <button
                type="submit"
                className="w-full rounded-full bg-brand py-3.5 font-display text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-brand-dark"
              >
                {info?.type === "subscription"
                  ? "Start Subscription"
                  : "Create Account"}
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
