import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";

type HealthResponse = {
  status: string;
  service: string;
  timestamp: string;
};

async function getHealth(): Promise<HealthResponse> {
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const res = await fetch(`${base}/api/health`, { cache: "no-store" });

  if (!res.ok) {
    throw new Error("Failed to fetch API health");
  }

  return res.json();
}

async function Health() {
  const health = await getHealth();
  return (
    <pre className="api-pre">
      {JSON.stringify(health, null, 2)}
    </pre>
  );
}

export default function ApiPage() {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="dashboard-wrap">
        <h1 className="dashboard-heading mb-7">API endpoint response</h1>
        <Suspense fallback={<p className="dashboard-empty">Loading...</p>}>
          <Health />
        </Suspense>
        <Link href="/" className="button-secondary mt-6">Back home</Link>
      </section>
    </main>
  );
}
