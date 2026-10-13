"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";

export function AcceptInvitation({ config }: { config: { invitationId: string; organizationSlug: string } }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <Button disabled={pending} onClick={async () => {
        setPending(true);
        setError("");
        try {
          const result = await authClient.organization.acceptInvitation({ invitationId: config.invitationId });
          if (result.error) throw new Error(result.error.message ?? "Could not accept the invitation.");
          router.push(`/dashboard/organizations/${encodeURIComponent(config.organizationSlug)}`);
          router.refresh();
        } catch (error) {
          setError(error instanceof Error ? error.message : "Could not accept the invitation. Please try again.");
          setPending(false);
        }
      }}>
        {pending ? "Joining..." : "Accept invitation"}
      </Button>
      {error && <FormError>{error}</FormError>}
    </>
  );
}
