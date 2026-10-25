import { ContactForm } from "@/components/contact-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata = { title: "Contact | subtubes" };

export default function ContactPage() {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="auth-layout">
        <div className="auth-card">
          <p className="auth-kicker">Contact</p>
          <h1 className="auth-title">Get in touch</h1>
          <p className="auth-subtitle">
            Questions about Subtubes, your membership or your account? Send us a message and we&apos;ll reply by email.
          </p>
          <ContactForm />
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
