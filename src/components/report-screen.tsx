"use client";
import { useEffect, useState } from "react";
import ReportContent from "./report-content";
import { isReportAnalysis, type CompletedReport } from "@/lib/report";

export default function ReportScreen({ revision }: { revision: number }) {
  const [report, setReport] = useState<CompletedReport | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let active = true;
    setChecking(true); setError("");
    // Completion is a same-origin POST when this screen opens. Page GETs and
    // prefetches never consume a report. The server makes repeats idempotent.
    fetch("/api/report", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision }),
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "We couldn’t open your report. Please try again.");
      if (typeof data.id !== "string" || !Number.isFinite(data.completed) || !isReportAnalysis(data.analysis)) throw new Error("We couldn’t open your saved report. Please try again.");
      if (active) setReport(data);
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : "Please try again."); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [revision, retry]);
  if (report) return <ReportContent report={report} />;
  return <section className="intake-panel report-opening">
    <h1>{checking ? "Opening your report." : "Let’s try that again."}</h1>
    {checking && <p className="form-intro" role="status">Saving your completed report so you can come back to it.</p>}
    {error && <>
      <p className="form-error" role="alert">{error}</p>
      <button className="primary-button form-button" onClick={() => setRetry(current => current + 1)}>Open my report again</button>
      <a className="back-link" href="/scan">Back to label photos</a>
    </>}
  </section>;
}
