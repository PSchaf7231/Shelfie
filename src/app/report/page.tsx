import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ReportContent from "@/components/report-content";
import ReportScreen from "@/components/report-screen";
import { intakeStore, IntakeError } from "@/lib/intake";
import { SESSION_COOKIE } from "@/lib/intake-http";
import { CATALOG_VERSION } from "@/lib/ingredients/catalog";
import { REPORT_DISCLAIMER } from "@/lib/report";

export const runtime = "nodejs";
export default async function ReportPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value || "";
  const store = intakeStore();
  if ((await store.status(token)).state !== "verified") redirect("/intake");
  let content;
  try {
    const report = await store.getReport(token);
    if (report) content = <ReportContent report={report} />;
    else {
      const batch = await store.photoBatch(token);
      if (!batch.photos.length || !await store.ingredientAnalysis(token, batch.revision, CATALOG_VERSION)) redirect("/scan");
      content = <ReportScreen revision={batch.revision} />;
    }
  } catch (error) {
    if (!(error instanceof IntakeError)) throw error;
    if (error.status === 401) redirect("/intake");
    if (error.status === 409) redirect("/scan");
    content = <section className="intake-panel"><h1>We couldn’t open your report.</h1><p className="form-error" role="alert">{error.message}</p><a className="back-link" href="/report">Try opening it again</a></section>;
  }
  return <div className="intake-shell report-shell">
    <header><a className="brand brand-link" href="/">Shelfie</a></header>
    <main>{content}</main>
    <footer>{REPORT_DISCLAIMER}</footer>
  </div>;
}
