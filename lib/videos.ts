// The Vimeo videos shown in the home page carousel, as page URLs (https://vimeo.com/123456789). Add or reorder them here.
export const VIMEO_VIDEO_URLS: string[] = [];

export interface Video {
  /** Null for a placeholder, which is shown but not linked. */
  url: string | null;
  title: string;
  /** Null for a placeholder, which is drawn as a gradient tile. */
  thumbnail: string | null;
}

// Shown until real videos are added above, so the carousel has something to look at.
const PLACEHOLDERS: Video[] = [
  "Diagram a system in minutes",
  "Connect a design to your code",
  "Walk through a scenario",
  "Use the desktop app",
  "Review a design with your team",
].map((title) => ({ url: null, title, thumbnail: null }));

// Titles and thumbnails come from Vimeo's public oEmbed endpoint and are cached for a day. A video Vimeo cannot describe
// (private, deleted, or Vimeo is down) is left out rather than breaking the page.
async function describe(url: string): Promise<Video | null> {
  try {
    const response = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}&width=640`, {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { title?: unknown; thumbnail_url?: unknown };
    if (typeof data.thumbnail_url !== "string" || !data.thumbnail_url.startsWith("https://")) return null;
    return { url, title: typeof data.title === "string" ? data.title : "Subtubes video", thumbnail: data.thumbnail_url };
  } catch {
    return null;
  }
}

export async function loadVideos(): Promise<Video[]> {
  if (VIMEO_VIDEO_URLS.length === 0) return PLACEHOLDERS;
  return (await Promise.all(VIMEO_VIDEO_URLS.map(describe))).filter((video): video is Video => video !== null);
}
