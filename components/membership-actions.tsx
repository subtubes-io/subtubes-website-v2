"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";

// Sends the person to Stripe: Checkout to become a member, the billing portal to manage the membership.
export function MembershipAction({ action, interval, variant, children }: {
  action: "checkout" | "portal";
  interval?: "month" | "year";
  variant?: "primary" | "secondary";
  children: string;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function go() {
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/membership/${action}`, {
        method: "POST",
        ...(interval && { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interval }) }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.url) { window.location.assign(body.url); return; }
      setError(body?.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setPending(false);
  }

  return (
    <>
      <Button variant={variant} disabled={pending} onClick={go}>{pending ? "Redirecting..." : children}</Button>
      {error && <FormError>{error}</FormError>}
    </>
  );
}
