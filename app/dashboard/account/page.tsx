import { Suspense } from "react";
import { AccountDetails } from "@/components/account-details";

export default function AccountPage() {
  return (
    <Suspense fallback={<p className="dashboard-empty">Loading account...</p>}>
      <AccountDetails section="account" />
    </Suspense>
  );
}
