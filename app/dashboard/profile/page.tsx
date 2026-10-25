import { Suspense } from "react";
import { AccountDetails } from "@/components/account-details";

export default function ProfilePage() {
  return (
    <Suspense fallback={<p className="dashboard-empty">Loading profile...</p>}>
      <AccountDetails section="profile" />
    </Suspense>
  );
}
