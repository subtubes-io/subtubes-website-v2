"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import { CONTACT_LIMITS } from "@/lib/contact";

export function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) return <p className="newsletter-done" role="status">Thanks! Your message is on its way. We&apos;ll reply by email.</p>;

  return (
    <form
      className="auth-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true); setError("");
        try {
          const response = await fetch("/api/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          });
          if (response.ok) { setSent(true); return; }
          const body = await response.json().catch(() => null);
          setError(body?.error ?? "Could not send your message. Please try again.");
        } catch {
          setError("Could not send your message. Please try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="field-label">
        Name
        <Input required maxLength={CONTACT_LIMITS.name} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      </label>
      <label className="field-label">
        Email
        <Input required type="email" maxLength={254} autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
      </label>
      <label className="field-label">
        Message
        <textarea
          required
          rows={6}
          maxLength={CONTACT_LIMITS.message}
          className="site-input contact-message"
          value={form.message}
          onChange={(event) => setForm({ ...form, message: event.target.value })}
        />
      </label>
      <Button type="submit" disabled={pending} fullWidth>{pending ? "Sending..." : "Send message"}</Button>
      {error && <FormError>{error}</FormError>}
    </form>
  );
}
