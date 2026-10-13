"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";

export function GitHubButton({ callbackURL, disabled }: { callbackURL: string; disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        disabled={disabled || pending}
        onClick={async () => {
          setPending(true); setError("");
          const result = await authClient.signIn.social({ provider: "github", callbackURL });
          if (result.error) { setError(result.error.message ?? "Could not start GitHub sign-in."); setPending(false); }
        }}
        variant="secondary"
        fullWidth
      >
        {pending ? "Redirecting to GitHub..." : "Continue with GitHub"}
      </Button>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
