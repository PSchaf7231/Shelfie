import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import PhotoCapture from "@/components/photo-capture";
import SiteFooter from "@/components/site-footer";
import { intakeStore } from "@/lib/intake";
import { SESSION_COOKIE } from "@/lib/intake-http";

export const runtime = "nodejs";
export default async function ScanPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value || "";
  const status = await intakeStore().status(token);
  if (status.state !== "verified") redirect("/intake");
  if (!status.eligible) redirect("/report");
  return <div className="intake-shell photo-shell">
    <header><a className="brand brand-link" href="/">Shelfie</a></header>
    <main><PhotoCapture /></main>
    <SiteFooter />
  </div>;
}
