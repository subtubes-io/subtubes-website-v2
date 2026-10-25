import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>© Subtubes</span>
      <nav className="site-footer-links" aria-label="Footer">
        <Link href="/contact">Contact</Link>
        <Link href="/terms">Terms and Conditions</Link>
      </nav>
    </footer>
  );
}
