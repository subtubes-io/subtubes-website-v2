import { Suspense } from "react";
import { redirect } from "next/navigation";
import { MembershipAction } from "@/components/membership-actions";
import { getMembership } from "@/lib/membership/membership";
import { hasMembership, ANNUAL_SAVINGS_USD, MEMBERSHIP_PRICES_USD } from "@/lib/membership/plan";
import { getSession } from "@/lib/session";

type Search = Promise<{ checkout?: string | string[] }>;

const date = (value: Date) => value.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

async function Membership({ searchParams }: { searchParams: Search }) {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/dashboard/membership");
  const membership = await getMembership(session.user.id);
  const member = hasMembership(membership?.status);
  const checkout = (await searchParams).checkout;

  return (
    <>
      <header className="dashboard-header">
        <h1 className="dashboard-heading">Membership</h1>
      </header>
      {checkout === "success" && !member && (
        <p role="status" className="notice">Thanks! Your payment is being confirmed. This page updates in a moment, so refresh it shortly.</p>
      )}
      {checkout === "cancelled" && <p role="status" className="notice">Checkout was cancelled. You have not been charged.</p>}
      <section className="dashboard-section">
        {member ? (
          <>
            <h2 className="dashboard-section-title">You&apos;re a member</h2>
            <p className="dashboard-empty">
              {membership?.currentPeriodEnd && (membership.cancelAtPeriodEnd
                ? `Ends on ${date(membership.currentPeriodEnd)}.`
                : `Renews on ${date(membership.currentPeriodEnd)}.`)}
              {membership?.status === "past_due" && " Your last payment failed; update your card to keep your membership."}
            </p>
            <MembershipAction action="portal">Manage billing</MembershipAction>
          </>
        ) : (
          <>
            <h2 className="dashboard-section-title">Subtubes membership</h2>
            <p className="dashboard-empty">Choose how you want to pay. Cancel any time.</p>
            <div className="membership-choices">
              <MembershipAction action="checkout" interval="month">{`Monthly, $${MEMBERSHIP_PRICES_USD.month}/month`}</MembershipAction>
              <MembershipAction action="checkout" interval="year" variant="secondary">{`Yearly, $${MEMBERSHIP_PRICES_USD.year}/year (save $${ANNUAL_SAVINGS_USD})`}</MembershipAction>
            </div>
          </>
        )}
      </section>
    </>
  );
}

export default function MembershipPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<p className="dashboard-empty">Loading...</p>}>
      <Membership searchParams={searchParams} />
    </Suspense>
  );
}
