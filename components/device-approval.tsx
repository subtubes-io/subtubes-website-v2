"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";

type Stage = "enter" | "confirm" | "approved" | "denied";
type ApiResult = { error: { message?: string; error_description?: string } | null };

export function DeviceApproval({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode);
  const [stage, setStage] = useState<Stage>("enter");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const normalized = code.trim().replace(/-/g, "").toUpperCase();

  async function run(action: () => Promise<ApiResult>, next: Stage) {
    setPending(true); setError("");
    const { error } = await action();
    setPending(false);
    if (error) { setError(error.error_description ?? error.message ?? "That code is invalid or has expired."); return; }
    setStage(next);
  }

  if (stage === "approved") return <p role="status" className="dashboard-empty">Device approved. Return to the Subtubes IRE app; it will finish signing in.</p>;
  if (stage === "denied") return <p role="status" className="dashboard-empty">Request denied. You can close this page.</p>;
  return (
    <div className="flex flex-col gap-4">
      {stage === "enter" ? (
        <form className="organization-form" onSubmit={(event) => { event.preventDefault(); void run(() => authClient.device({ query: { user_code: normalized } }), "confirm"); }}>
          <label className="flex-1">
            <span className="sr-only">Device code</span>
            <Input
              required autoFocus value={code} onChange={(event) => setCode(event.target.value)} placeholder="Code shown in the app" autoComplete="off"
              className="site-input-code"
            />
          </label>
          <Button type="submit" disabled={pending || !normalized}>Continue</Button>
        </form>
      ) : (
        <>
          <p className="device-question">Allow the Subtubes IRE app with code <span className="font-mono font-semibold tracking-widest">{normalized}</span> to access your account? Only approve if you started this sign-in.</p>
          <div className="flex gap-3">
            <Button type="button" disabled={pending} onClick={() => void run(() => authClient.device.approve({ userCode: normalized }), "approved")}>Approve</Button>
            <Button type="button" disabled={pending} onClick={() => void run(() => authClient.device.deny({ userCode: normalized }), "denied")} variant="secondary">Deny</Button>
          </div>
        </>
      )}
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
