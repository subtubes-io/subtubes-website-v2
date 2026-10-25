import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

// Each person sees only their own dashboard.
async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/dashboard");
  const { user } = session;

  return (
    <>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-heading">Dashboard</h1>
        </div>
      </header>

      <section aria-labelledby="your-account" className="dashboard-section">
        <h2 id="your-account" className="dashboard-section-title">{user.name || "Your account"}</h2>
        <p className="dashboard-empty">{user.email}</p>
        <p><Link href="/dashboard/account" className="text-link">Account</Link></p>
        <p><Link href="/dashboard/profile" className="text-link">Profile</Link></p>
      </section>
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="dashboard-empty">Loading...</p>}>
      <Dashboard />
    </Suspense>
  );
}
