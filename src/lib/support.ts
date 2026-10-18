import { randomUUID } from "node:crypto";
import { PostgresDatabase } from "./postgres";
import { IntakeError } from "./errors";

export const SUPPORT_OWNER_EMAIL = "paulschafranick@gmail.com";
export type SupportInput = { name: string; email: string; message: string; screenshot?: Buffer };
export function validateSupport(value: { name: unknown; email: unknown; message: unknown }): Omit<SupportInput, "screenshot"> {
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 || typeof value.email !== "string" || value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()) || typeof value.message !== "string" || !value.message.trim() || value.message.length > 2000) throw new IntakeError("Please enter your name, a valid email, and a message of up to 2,000 characters.");
  return { name: value.name.trim(), email: value.email.trim().toLowerCase(), message: value.message.trim() };
}
export class SupportStore {
  readonly database: PostgresDatabase;
  constructor(url: string | undefined) { this.database = new PostgresDatabase(url); }
  close() { return this.database.close(); }
  async save(value: SupportInput, reference: string = randomUUID(), now = Date.now()) {
    const input = validateSupport(value);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(reference) || value.screenshot && value.screenshot.length > 600000) throw new IntakeError("Please reopen the help form and try again.");
    return this.database.transaction(async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('shelfie:support',0))");
      const existing = (await db.query("SELECT * FROM support_messages WHERE id=$1", [reference])).rows[0];
      if (existing) {
        if (existing.name !== input.name || existing.email !== input.email || existing.message !== input.message || !Buffer.from(existing.screenshot || []).equals(value.screenshot || Buffer.alloc(0))) throw new IntakeError("Start a new message if you want to change its contents.", 409);
        return { reference, emailState: existing.email_state as 'pending' | 'accepted' | 'failed' };
      }
      const count = (await db.query("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE email=$1) AS per_email FROM support_messages WHERE created > $2", [input.email, now - 3600000])).rows[0];
      if (Number(count.total) >= 30 || Number(count.per_email) >= 3) throw new IntakeError("Please wait before sending another message. You can also call 561-255-7285.", 429);
      await db.query("INSERT INTO support_messages(id,name,email,message,screenshot,created) VALUES($1,$2,$3,$4,$5,$6)", [reference,input.name,input.email,input.message,value.screenshot || null,now]);
      return { reference, emailState: 'pending' as const };
    });
  }
  async markDelivery(reference: string, state: 'accepted' | 'failed') {
    await this.database.read(async db => { await db.query("UPDATE support_messages SET email_state=$2 WHERE id=$1", [reference,state]); });
  }
}
// The app always uses the fixed owner address. The optional recipient argument
// is used only by the private build check with Resend's documented test inbox.
export async function sendSupportNotification(input: SupportInput, reference: string, fetcher: typeof fetch = fetch, recipient = SUPPORT_OWNER_EMAIL) {
  if (!process.env.EMAIL_PROVIDER_API_KEY || !process.env.EMAIL_FROM) throw new IntakeError("Email is unavailable.",503);
  const response = await fetcher("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}`, "Content-Type":"application/json", "Idempotency-Key":`shelfie-help-${reference}` }, body: JSON.stringify({
    from: process.env.EMAIL_FROM, to:[recipient], reply_to: input.email,
    subject:`Shelfie help — ${reference.slice(0,8)}`,
    text:`Shelfie help message\nReference: ${reference}\nName: ${input.name}\nReply email: ${input.email}\n\n${input.message}\n\nReply directly to this email to contact the sender.`,
    ...(input.screenshot ? { attachments:[{ filename:"shelfie-screenshot.jpg",content:input.screenshot.toString("base64") }] } : {}),
  }) });
  if (!response.ok) throw new IntakeError("Email is unavailable.",503);
}
