"use client";

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { FormError } from "@/components/ui/form-error";

export function ProfileAvatar({ image, name, username }: { image?: string | null; name: string; username?: string | null }) {
  const router = useRouter();
  const { refetch } = authClient.useSession();
  const picker = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const [avatar, setAvatar] = useState(image);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function upload(file: File) {
    if (uploading.current) return;
    setError(""); setSaved(false);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > 2 * 1024 * 1024) {
      setError("Choose a PNG, JPEG, or WebP image up to 2 MB.");
      return;
    }
    uploading.current = true;
    setPending(true);
    try {
      const data = new FormData();
      data.set("avatar", file);
      const response = await fetch("/api/profile/avatar", { method: "POST", body: data });
      const result: { image?: string; error?: string } = await response.json();
      if (!response.ok || !result.image) throw new Error(result.error ?? "Could not upload your avatar.");
      setAvatar(result.image);
      await refetch();
      router.refresh();
      setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not upload your avatar.");
    } finally {
      uploading.current = false;
      setPending(false);
    }
  }

  return (
    <section className="profile-avatar-section" aria-labelledby="avatar-heading">
      <button type="button" className="profile-avatar-preview" aria-label="Change profile photo"
        aria-busy={pending} disabled={pending}
        onClick={() => picker.current?.click()}>
        {avatar ? (
          // Public Blob avatars and existing provider images do not need an image proxy.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt={`${name}'s avatar`} width={96} height={96} />
        ) : <span aria-label="No avatar uploaded">{name.trim().slice(0, 1).toUpperCase()}</span>}
        <span className="profile-avatar-picker-icon" aria-hidden="true"><Camera size={18} /></span>
      </button>
      <input ref={picker} className="sr-only" tabIndex={-1} aria-label="Choose avatar image"
        name="avatar" type="file" accept="image/png,image/jpeg,image/webp" disabled={pending}
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (selected) void upload(selected);
        }} />
      <div className="profile-avatar-form">
        <h2 id="avatar-heading">{name}</h2>
        <p className="profile-avatar-username">{username ? `@${username}` : "Username not set"}</p>
        {error && <FormError>{error}</FormError>}
        {pending ? <p role="status">Uploading photo...</p> : saved && <p role="status">Avatar updated.</p>}
      </div>
    </section>
  );
}
