export const profilePlatforms = [
  { key: "x", label: "X", host: "x.com", placeholder: "https://x.com/username" },
  { key: "linkedin", label: "LinkedIn", host: "linkedin.com", placeholder: "https://www.linkedin.com/in/username" },
  { key: "github", label: "GitHub", host: "github.com", placeholder: "https://github.com/username" },
  { key: "huggingface", label: "Hugging Face", host: "huggingface.co", placeholder: "https://huggingface.co/username" },
] as const;

export type ProfilePlatform = typeof profilePlatforms[number]["key"];
export type ProfileLinks = Record<ProfilePlatform, string | null>;
export const emptyProfileLinks: ProfileLinks = { x: null, linkedin: null, github: null, huggingface: null };

export function parseProfileLinks(input: unknown): ProfileLinks {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Provide your profile links.");
  const result = { ...emptyProfileLinks };
  for (const platform of profilePlatforms) {
    const value = Reflect.get(input, platform.key);
    if (value === null || value === "") continue;
    if (typeof value !== "string" || value.length > 500) throw new Error(`Enter a valid ${platform.label} profile URL.`);
    const trimmed = value.trim();
    if (!trimmed) continue;
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error(`Enter a full HTTPS ${platform.label} profile URL.`);
    }
    if (url.protocol !== "https:" || ![platform.host, `www.${platform.host}`].includes(url.hostname)
      || url.username || url.password || url.port || url.pathname === "/") {
      throw new Error(`Use an HTTPS profile URL on ${platform.host}.`);
    }
    url.search = "";
    url.hash = "";
    if (url.toString().length > 500) throw new Error(`${platform.label} profile URL must be at most 500 characters.`);
    result[platform.key] = url.toString();
  }
  return result;
}
