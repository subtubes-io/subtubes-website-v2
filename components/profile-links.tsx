"use client";

import { useState } from "react";
import { Github, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { profilePlatforms, parseProfileLinks, type ProfileLinks, type ProfilePlatform } from "@/lib/profile-links";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";

function PlatformIcon({ platform }: { platform: ProfilePlatform }) {
  if (platform === "github") return <Github size={18} aria-hidden="true" />;
  if (platform === "linkedin") return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="2" fill="currentColor" />
      <circle cx="5.5" cy="6" r="1.5" fill="var(--surface)" />
      <path d="M4 10h3v10H4V10Zm6 0h3v1.4c.8-1.2 1.8-1.6 3.2-1.6 2.5 0 3.8 1.6 3.8 4.5V20h-3v-5.2c0-1.5-.5-2.3-1.7-2.3-1.4 0-2.3.9-2.3 2.5v5h-3V10Z" fill="var(--surface)" />
    </svg>
  );
  if (platform === "huggingface") return <span className="hugging-face-icon" aria-hidden="true">🤗</span>;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 3h5l11 18h-5L4 3ZM20 3 4 21" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function ProfileLinksEditor({ initialLinks }: { initialLinks: ProfileLinks }) {
  const router = useRouter();
  const [values, setValues] = useState(initialLinks);
  const [savedLinks, setSavedLinks] = useState(initialLinks);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setSaved(false);
    let links: ProfileLinks;
    try {
      links = parseProfileLinks(values);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Check your profile links.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/profile/links", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(links),
      });
      const result: { links?: ProfileLinks; error?: string } = await response.json();
      if (!response.ok || !result.links) throw new Error(result.error ?? "Could not save your profile links.");
      const saved = parseProfileLinks(result.links);
      setValues(saved); setSavedLinks(saved); setSaved(true);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save your profile links.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="profile-links-form" onSubmit={(event) => void save(event)} aria-labelledby="profile-links-heading">
      <h2 id="profile-links-heading">Social links</h2>
      <p className="profile-links-help">Add your profile URLs. Leave a field blank to remove a link.</p>
      {profilePlatforms.map((platform) => (
        <div className="profile-link-field" key={platform.key}>
          <label className="sr-only" htmlFor={`profile-link-${platform.key}`}>{platform.label}</label>
          <div className="profile-link-input">
            <span className="profile-link-icon" title={platform.label}><PlatformIcon platform={platform.key} /></span>
            <Input id={`profile-link-${platform.key}`} type="url" maxLength={500}
              value={values[platform.key] ?? ""} placeholder={platform.placeholder} disabled={pending}
              autoComplete="off" spellCheck={false}
              onChange={(event) => {
                setValues({ ...values, [platform.key]: event.target.value }); setSaved(false); setError("");
              }} />
            {savedLinks[platform.key] && (
              <a href={savedLinks[platform.key]!} target="_blank" rel="noopener noreferrer"
                aria-label={`Open ${platform.label} profile`}><ExternalLink size={18} aria-hidden="true" /></a>
            )}
          </div>
        </div>
      ))}
      <Button type="submit" size="compact" fullWidth disabled={pending}>{pending ? "Saving..." : "Save links"}</Button>
      {error && <FormError>{error}</FormError>}
      {saved && <p role="status">Profile links saved.</p>}
    </form>
  );
}
