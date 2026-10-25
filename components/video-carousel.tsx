"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { Video } from "@/lib/videos";

const PLACEHOLDER_GRADIENTS = [
  "linear-gradient(135deg, #0f3d57, #1e6f9f)",
  "linear-gradient(135deg, #1f3a5f, #5b6ee1)",
  "linear-gradient(135deg, #12493f, #2ba58a)",
  "linear-gradient(135deg, #3d2a5c, #9b5bd1)",
  "linear-gradient(135deg, #5a2f2f, #d1735b)",
];

// A row of video thumbnails that scrolls sideways. Each one is a plain link to the video on Vimeo.
export function VideoCarousel({ videos }: { videos: Video[] }) {
  const track = useRef<HTMLUListElement>(null);
  const scroll = (direction: 1 | -1) => {
    const element = track.current;
    if (element) element.scrollBy({ left: direction * element.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="carousel">
      <button type="button" className="carousel-button carousel-prev" aria-label="Previous videos" onClick={() => scroll(-1)}>
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <ul ref={track} className="carousel-track">
        {videos.map((video, index) => {
          const content = (
            <>
              {video.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- Vimeo's CDN thumbnails, already sized
                <img src={video.thumbnail} alt="" loading="lazy" className="carousel-image" />
              ) : (
                <span className="carousel-image" style={{ background: PLACEHOLDER_GRADIENTS[index % PLACEHOLDER_GRADIENTS.length] }} aria-hidden="true" />
              )}
              <span className="carousel-play" aria-hidden="true"><Play size={18} fill="currentColor" /></span>
              <span className="carousel-title">
                {video.title}
                {video.url && <span className="sr-only"> (opens on Vimeo)</span>}
              </span>
            </>
          );
          return (
            <li key={video.url ?? video.title} className="carousel-item">
              {video.url
                ? <a href={video.url} target="_blank" rel="noopener noreferrer" className="carousel-link">{content}</a>
                : <div className="carousel-link">{content}</div>}
            </li>
          );
        })}
      </ul>
      <button type="button" className="carousel-button carousel-next" aria-label="Next videos" onClick={() => scroll(1)}>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
