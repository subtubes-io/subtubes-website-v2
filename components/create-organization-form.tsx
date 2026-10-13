"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import { normalizeOrganizationSlug } from "@/lib/organization-slug";

export function CreateOrganizationForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="organization-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true); setError("");
        const { error } = await authClient.organization.create({ name: name.trim(), slug: normalizeOrganizationSlug(name) });
        setPending(false);
        if (error) { setError(error.message ?? "Could not create the organization."); return; }
        setName(""); router.refresh();
      }}
    >
      <label>
        <span className="sr-only">Organization name</span>
        <Input
          required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="New organization name"
        />
      </label>
      <Button
        type="submit" disabled={pending || !normalizeOrganizationSlug(name)}
      >
        {pending ? "Creating..." : "Create organization"}
      </Button>
      {error && <FormError className="basis-full">{error}</FormError>}
    </form>
  );
}
