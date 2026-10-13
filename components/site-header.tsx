"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { SiteHeaderView } from "./site-header-view";

export function SiteHeader() {
  const router = useRouter();
  const { data, isPending, error: sessionError, refetch } = authClient.useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError(result.error.message ?? "Could not sign out. Please try again.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  return <SiteHeaderView config={{
    user: data?.user ?? null,
    loading: isPending,
    signingOut,
    error: error || (sessionError ? "Could not load your session. Please retry." : ""),
    onSignOut: signOut,
    onRetry: () => { setError(""); void refetch(); },
  }} />;
}
