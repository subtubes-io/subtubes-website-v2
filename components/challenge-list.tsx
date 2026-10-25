"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Play, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CHALLENGE_CATEGORIES, type Challenge, type ChallengeCategory } from "@/lib/challenges";

const GRADIENTS = [
  "linear-gradient(135deg, #0f3d57, #1e6f9f)",
  "linear-gradient(135deg, #1f3a5f, #5b6ee1)",
  "linear-gradient(135deg, #12493f, #2ba58a)",
  "linear-gradient(135deg, #3d2a5c, #9b5bd1)",
  "linear-gradient(135deg, #5a2f2f, #d1735b)",
];

// A searchable list of challenges with category filters. Search matches the title and description.
export function ChallengeList({ challenges }: { challenges: Challenge[] }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ChallengeCategory | "All">("All");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return challenges.filter((challenge) =>
      (category === "All" || challenge.category === category) &&
      (!needle || `${challenge.title} ${challenge.description}`.toLowerCase().includes(needle)));
  }, [challenges, query, category]);

  return (
    <div className="video-library">
      <div className="video-search">
        <label htmlFor={searchId} className="sr-only">Search challenges</label>
        <Search size={16} aria-hidden="true" className="video-search-icon" />
        <Input id={searchId} type="search" placeholder="Search challenges" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="video-categories" role="group" aria-label="Filter by category">
        {(["All", ...CHALLENGE_CATEGORIES] as const).map((name) => (
          <button key={name} type="button" className="video-chip" aria-pressed={category === name} onClick={() => setCategory(name)}>
            {name}
          </button>
        ))}
      </div>
      <p role="status" className="dashboard-empty">{shown.length} {shown.length === 1 ? "challenge" : "challenges"}</p>
      {shown.length === 0 ? (
        <p className="dashboard-empty">No challenges match. Try a different search or category.</p>
      ) : (
        <ul className="video-list">
          {shown.map((challenge) => (
            <li key={challenge.id}>
            <Link href={`/challenges/${challenge.id}`} className="video-row">
              <span className="video-thumb" style={{ background: GRADIENTS[Number(challenge.id) % GRADIENTS.length] }} aria-hidden="true">
                <Play size={16} fill="currentColor" />
              </span>
              <span className="video-info">
                <span className="video-title">{challenge.title}</span>
                <span className="video-description">{challenge.description}</span>
              </span>
              <span className="video-category">{challenge.category}</span>
              <span className="video-duration">{challenge.duration}</span>
            </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
