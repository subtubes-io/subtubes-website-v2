// Sends mail through Resend's REST API (https://resend.com/docs/api-reference/emails/send-email); no SDK needed for one call.

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY);

export async function sendEmail(email: Email): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Without a key, local development prints the mail instead of sending it. Production must not silently drop it.
    if (process.env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set.");
    console.info(`[email not sent: RESEND_API_KEY is not set]\nTo: ${email.to}\nSubject: ${email.subject}\n${email.text}`);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Subtubes <onboarding@resend.dev>",
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Resend responded ${response.status}: ${(await response.text()).slice(0, 300)}`);
}
