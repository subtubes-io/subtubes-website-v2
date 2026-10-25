import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

// Each person sees only their own dashboard.
async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/dashboard");

  return (
    <>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-heading">Dashboard</h1>
        </div>
      </header>
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
