import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { ANNUAL_SAVINGS_USD, MEMBERSHIP_PRICES_USD } from "@/lib/membership/plan";

// The monthly and yearly plan cards. `action` makes the button under each, so the home page and the pricing page can differ.
export function PricingCards({ action }: { action: (label: string) => ReactNode }) {
  return (
    <div className="pricing-cards">
      <div className="pricing-card">
        <div>
          <p className="pricing-plan">Monthly</p>
          <p className="pricing-price">${MEMBERSHIP_PRICES_USD.month}<span> / month</span></p>
        </div>
        <ul className="pricing-list">
          <li><Check size={16} aria-hidden="true" /> Full access to Subtubes</li>
          <li><Check size={16} aria-hidden="true" /> Billed monthly</li>
          <li><Check size={16} aria-hidden="true" /> Cancel any time</li>
        </ul>
        {action("Choose monthly")}
      </div>
      <div className="pricing-card pricing-card-featured">
        <div>
          <p className="pricing-plan">Yearly <span className="pricing-badge">Save ${ANNUAL_SAVINGS_USD}</span></p>
          <p className="pricing-price">${MEMBERSHIP_PRICES_USD.year}<span> / year</span></p>
        </div>
        <ul className="pricing-list">
          <li><Check size={16} aria-hidden="true" /> Full access to Subtubes</li>
          <li><Check size={16} aria-hidden="true" /> Billed once a year</li>
          <li><Check size={16} aria-hidden="true" /> Cancel any time</li>
        </ul>
        {action("Choose yearly")}
      </div>
    </div>
  );
}
