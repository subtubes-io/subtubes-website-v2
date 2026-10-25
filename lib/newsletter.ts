const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims and lowercases an address; throws a message fit to show the visitor when it is not usable. */
export function parseNewsletterEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter your email address.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new Error("Enter a valid email address.");
  return email;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function confirmationEmail(to: string, token: string, siteUrl: string) {
  const link = `${siteUrl.replace(/\/+$/, "")}/api/newsletter/confirm?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Confirm your Subtubes newsletter signup",
    text: `Confirm your subscription to the Subtubes newsletter:\n\n${link}\n\nIf you didn't ask for this, ignore this email and you won't hear from us.`,
    html: `<p>Confirm your subscription to the Subtubes newsletter:</p><p><a href="${escapeHtml(link)}">Confirm subscription</a></p><p>If you didn't ask for this, ignore this email and you won't hear from us.</p>`,
  };
}
