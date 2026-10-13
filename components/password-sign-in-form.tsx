"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";

export function PasswordSignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="auth-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true); setError("");
        const value = identifier.trim();
        const { error } = value.includes("@")
          ? await authClient.signIn.email({ email: value, password })
          : await authClient.signIn.username({ username: value, password });
        setPending(false);
        if (error) { setError(error.message ?? "Could not sign in. Check your details and try again."); return; }
        router.push(next); router.refresh();
      }}
    >
      <label className="field-label">
        Email or username
        <Input required autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
      </label>
      <label className="field-label">
        Password
        <Input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <Button type="submit" disabled={pending} fullWidth>
        {pending ? "Signing in..." : "Sign in"}
      </Button>
      {error && <FormError>{error}</FormError>}
    </form>
  );
}
