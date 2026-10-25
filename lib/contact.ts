import { parseNewsletterEmail } from "@/lib/newsletter";

export interface ContactMessage {
  name: string;
  email: string;
  message: string;
}

export const CONTACT_LIMITS = { name: 80, message: 5000 } as const;

/** Trims and checks a contact form submission; throws a message fit to show the visitor. */
export function parseContactMessage(value: unknown): ContactMessage {
  if (typeof value !== "object" || value === null) throw new Error("Fill in the form.");
  const { name, email, message } = value as Record<string, unknown>;
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanMessage = typeof message === "string" ? message.trim() : "";
  if (!cleanName) throw new Error("Enter your name.");
  if (cleanName.length > CONTACT_LIMITS.name) throw new Error(`Your name must be at most ${CONTACT_LIMITS.name} characters.`);
  if (!cleanMessage) throw new Error("Write a message.");
  if (cleanMessage.length > CONTACT_LIMITS.message) throw new Error(`Your message must be at most ${CONTACT_LIMITS.message} characters.`);
  return { name: cleanName, email: parseNewsletterEmail(email), message: cleanMessage };
}

// The one place a message leaves the website. For now it is only stored (the contactMessage table); to email it too, send it
// with sendEmail from lib/email/resend.ts here and the form needs no other change.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the hook the Resend call will use
export async function deliverContactMessage(_message: ContactMessage): Promise<void> {}
