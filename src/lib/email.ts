import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { IntakeError } from "./intake";

export async function sendVerification(email: string, code: string, id: string) {
  if (process.env.NODE_ENV !== "production" && process.env.SHELFIE_EMAIL_MODE === "outbox") {
    const directory = resolve(".data/outbox");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(resolve(directory, `${id}.json`), JSON.stringify({ email, code }), { mode: 0o600 });
    return;
  }
  if (!process.env.EMAIL_PROVIDER_API_KEY || !process.env.EMAIL_FROM) throw new IntakeError("Email verification is temporarily unavailable. Please try again later.", 503);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": id },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [email], subject: "Your Shelfie verification code", text: `Your Shelfie code is ${code}. It expires in 10 minutes. Enter it in the browser where you started. If you did not request it, ignore this email.` }),
    });
    if (!response.ok) throw new Error("Delivery failed");
  } catch { throw new IntakeError("We couldn’t send your code. Please try again later.", 503); }
}
