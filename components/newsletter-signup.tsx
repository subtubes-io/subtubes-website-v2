"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";

export function NewsletterSignup() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return <p className="newsletter-done" role="status">Check your inbox to confirm your subscription.</p>;

  return (
    <form
      className="newsletter-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true); setError("");
        try {
          const response = await fetch("/api/newsletter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          if (response.ok) { setDone(true); return; }
          const body = await response.json().catch(() => null);
          setError(body?.error ?? "Could not sign you up. Please try again.");
        } catch {
          setError("Could not sign you up. Please try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="field-label">
        Email
        <Input required type="email" maxLength={254} autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <Button type="submit" disabled={pending}>{pending ? "Subscribing..." : "Subscribe"}</Button>
      {error && <FormError>{error}</FormError>}
    </form>
  );
}
