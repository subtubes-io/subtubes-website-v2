import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { MEMBERSHIP_PRICES_USD } from "@/lib/membership/plan";
import { CONTACT_EMAIL, TERMS_UPDATED } from "@/lib/site";

export const metadata = { title: "Terms and Conditions | subtubes" };

// A starting draft, not legal advice: have it reviewed before relying on it.
export default function TermsPage() {
  return (
    <main className="site-main">
      <SiteHeader />
      <article className="legal">
        <h1 className="legal-title">Terms and Conditions</h1>
        <p className="legal-updated">Last updated {TERMS_UPDATED}</p>

        <h2>1. Agreement</h2>
        <p>
          These terms govern your use of Subtubes, including the website and the desktop app. By creating an account or using
          Subtubes you agree to them. If you do not agree, do not use Subtubes.
        </p>

        <h2>2. Your account</h2>
        <p>
          You must provide accurate information and keep your sign-in details secure. You are responsible for activity under your
          account. Tell us promptly if you think someone else has accessed it.
        </p>

        <h2>3. Membership and payment</h2>
        <p>
          Membership costs ${MEMBERSHIP_PRICES_USD.month} per month or ${MEMBERSHIP_PRICES_USD.year} per year, as you choose at
          checkout. Payments are processed by Stripe. Your membership renews automatically at the end of each period until you
          cancel. You can cancel at any time from the billing portal in your dashboard; you keep access until the end of the period
          you have paid for. Except where the law requires otherwise, payments already made are not refunded.
        </p>

        <h2>4. Your content</h2>
        <p>
          You keep ownership of the designs and other content you create in Subtubes. You give us permission to store and process
          it only as needed to run the service for you.
        </p>

        <h2>5. Acceptable use</h2>
        <p>
          Do not misuse Subtubes: no attempting to break or overload it, access other people&apos;s accounts or data, or use it to
          break the law.
        </p>

        <h2>6. Availability and changes</h2>
        <p>
          We work to keep Subtubes available but do not guarantee uninterrupted service. We may change or discontinue features,
          and we may update these terms; the date above shows the latest version. Continuing to use Subtubes after a change means
          you accept it.
        </p>

        <h2>7. Termination</h2>
        <p>
          You may stop using Subtubes and delete your account at any time. We may suspend or end accounts that break these terms.
        </p>

        <h2>8. Liability</h2>
        <p>
          Subtubes is provided &ldquo;as is&rdquo;. To the extent the law allows, we are not liable for indirect or consequential
          losses, and our total liability to you is limited to the amount you paid us in the twelve months before the claim.
        </p>

        <h2>9. Contact</h2>
        <p>Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`} className="text-link">{CONTACT_EMAIL}</a>.</p>
      </article>
      <SiteFooter />
    </main>
  );
}
