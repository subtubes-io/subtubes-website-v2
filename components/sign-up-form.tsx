"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";

export function SignUpForm({ next }: { next: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", username: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  return (
    <form
      className="auth-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true); setError("");
        const { error } = await authClient.signUp.email({
          name: form.name.trim(), username: form.username.trim(), email: form.email.trim(), password: form.password,
        });
        setPending(false);
        if (error) { setError(error.message ?? "Could not create the account."); return; }
        router.push(next); router.refresh();
      }}
    >
      <label className="field-label">
        Name
        <Input required maxLength={80} autoComplete="name" value={form.name} onChange={set("name")} />
      </label>
      <label className="field-label">
        Username
        <Input required minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" title="Letters, numbers, underscores and dots" autoComplete="username" value={form.username} onChange={set("username")} />
      </label>
      <label className="field-label">
        Email
        <Input required type="email" autoComplete="email" value={form.email} onChange={set("email")} />
      </label>
      <label className="field-label">
        Password
        <Input required type="password" minLength={10} maxLength={128} autoComplete="new-password" value={form.password} onChange={set("password")} />
        <span className="form-hint">At least 10 characters.</span>
      </label>
      <Button type="submit" disabled={pending} fullWidth>
        {pending ? "Creating account..." : "Create account"}
      </Button>
      {error && <FormError>{error}</FormError>}
    </form>
  );
}
