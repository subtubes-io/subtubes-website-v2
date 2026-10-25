"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LIGHT_MODE_ENABLED } from "@/lib/theme";

export type HeaderUser = { name: string; email: string; image?: string | null };

type HeaderConfig = {
  user: HeaderUser | null;
  loading?: boolean;
  signingOut?: boolean;
  error?: string;
  onSignOut: () => void;
  onRetry?: () => void;
};

export function SiteHeaderView({ config }: { config: HeaderConfig }) {
  const { user, loading, signingOut, error, onSignOut, onRetry } = config;
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const initials = (user?.name || user?.email || "")
    .trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <header className="site-header" role="banner">
      <Link href="/" className="site-brand" aria-label="Subtubes home">
        {/* Both marks are in the page; the theme chooses which shows, so there is no flash on load. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="site-brand-mark site-brand-mark-light" src="/subtubes-mark-black.svg" alt="" width={28} height={28} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="site-brand-mark site-brand-mark-dark" src="/subtubes-mark-on-black.svg" alt="" width={28} height={28} />
        <span>Subtubes</span>
      </Link>
      <nav className="site-nav" aria-label="Main navigation">
        {LIGHT_MODE_ENABLED && <ThemeSwitcher />}
        {loading ? <span role="status" className="header-loading">Loading account...</span> :
          user ? (
            <>
              <Link href="/contact" className="nav-contact">Contact</Link>
              <div className="account-menu" ref={container}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && open) {
                    event.preventDefault();
                    setOpen(false);
                    trigger.current?.focus();
                  }
                }}>
                <button type="button" className="account-avatar" ref={trigger}
                  aria-label={`Account menu for ${user.name || user.email}`}
                  aria-expanded={open} aria-controls={panelId}
                  onClick={() => setOpen(!open)}>
                  {user.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.image} alt="" width={36} height={36} />
                  ) : <span aria-hidden="true">{initials}</span>}
                </button>
                {open && (
                  <div className="account-panel" id={panelId}>
                    <p className="account-name">{user.name || "Your account"}</p>
                    <p className="account-email">{user.email}</p>
                    <Link href="/dashboard/account" onClick={() => setOpen(false)}>Account</Link>
                    <Link href="/dashboard/profile" onClick={() => setOpen(false)}>Profile</Link>
                    <Link href="/dashboard" onClick={() => setOpen(false)}>Dashboard</Link>
                    <button type="button" disabled={signingOut} onClick={onSignOut}>
                      {signingOut ? "Signing out..." : "Sign out"}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : !error && (
            <>
              <Link href="/pricing" className="nav-pricing">Pricing</Link>
              <Link href="/contact" className="nav-contact">Contact</Link>
              <Link href="/sign-in" className="nav-sign-in">Sign in</Link>
              <Link href="/sign-up" className="nav-cta whitespace-nowrap">Get started</Link>
            </>
          )}
      </nav>
      {error && (
        <div className="header-error">
          <FormError>{error}</FormError>
          {!user && onRetry && <Button variant="secondary" onClick={onRetry}>Retry</Button>}
        </div>
      )}
    </header>
  );
}
