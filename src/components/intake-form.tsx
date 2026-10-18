"use client";
import { useEffect, useState, type FormEvent } from "react";
import SkinProfileForm from "./skin-profile-form";
import { skinProfile as emptySkinProfile } from "@/lib/skin-profile";
type Status = { state: "intake" | "pending" | "verified"; email?: string; eligible?: boolean; pregnancy?: boolean; glp1?: boolean };
export default function IntakeForm({ initialPregnancy }: { initialPregnancy: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pregnancy, setPregnancy] = useState(initialPregnancy);
  const [glp1, setGlp1] = useState(false);
  const [skinProfile, setSkinProfile] = useState(emptySkinProfile);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>({ state: "intake" });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profileNotice,setProfileNotice]=useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/intake/status", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Couldn’t check your verification. Please refresh to try again.");
      return response.json();
    }).then(data => { if (active) { setStatus(data); if (data.email) setEmail(data.email); if(data.skinProfile)setSkinProfile(emptySkinProfile(data.skinProfile)); } })
      .catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent, verify = false) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(verify ? "/api/verify-email" : "/api/intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(verify ? { code } : { name, email, pregnancy, glp1, skinProfile }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Please try again.");
      setStatus(data); setCode("");
    } catch (error) { setError(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault();setBusy(true);setError("");setProfileNotice("");
    try {
      const response=await fetch("/api/intake/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({skinProfile})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"We couldn’t save your skin profile.");
      setStatus(data);setSkinProfile(emptySkinProfile(data.skinProfile));setProfileNotice("Skin profile saved. Your photos and free report are unchanged.");
    }catch(error){setError(error instanceof Error?error.message:"We couldn’t save your profile.");}
    finally{setBusy(false);}
  }
  if (loading) return <p role="status">Checking your verification…</p>;
  if (status.state === "verified") return <section className="intake-panel">
    <h1>{status.eligible ? "You’re verified." : "Your free report is already used."}</h1>
    <p className="form-intro">{status.eligible ? "Your first report is still free. You can now photograph your product label." : "This email has already received its completed free report."}</p>
    <p className="form-help">Email verified: {status.email}</p>
    <ul className="preferences"><li>Pregnancy &amp; nursing mode: {status.pregnancy ? "On" : "Off"}</li><li>GLP-1 sensitive-skin mode: {status.glp1 ? "On" : "Off"}</li></ul>
    {status.eligible&&<form onSubmit={saveProfile}><fieldset className="skin-profile-fields" disabled={busy}><SkinProfileForm value={skinProfile} onChange={setSkinProfile}/><button className="secondary-button" disabled={busy}>{busy?"Saving…":"Save skin profile"}</button></fieldset></form>}
    {profileNotice&&<p className="photo-success" role="status">{profileNotice}</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {status.eligible && <a href="/scan" className="primary-button form-button">Photograph my label</a>}
    {!status.eligible && <a href="/report" className="primary-button form-button">View my report</a>}
    <a href="/" className="back-link">Back to Shelfie</a>
  </section>;
  return <section className="intake-panel">
    <h1>{status.state === "pending" ? "Check your email." : "Your first report starts here."}</h1>
    <p className="form-intro">{status.state === "pending" ? `Enter the six-digit code sent to ${status.email}. It expires in 10 minutes.` : "Your first report is free — no credit card needed."}</p>
    {status.state === "intake" ? <form onSubmit={event => submit(event)}>
      <label className="field">Name<input name="name" autoComplete="given-name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="field">Email<input name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
      <SkinProfileForm value={skinProfile} onChange={setSkinProfile} />
      <fieldset className="mode-options"><legend>Report preferences</legend>
        <label className="toggle-row"><span>Pregnancy &amp; nursing mode</span><input type="checkbox" role="switch" checked={pregnancy} onChange={event => setPregnancy(event.target.checked)} /></label>
        <label className="toggle-row"><span>GLP-1 sensitive-skin mode</span><input type="checkbox" role="switch" checked={glp1} onChange={event => setGlp1(event.target.checked)} /></label>
      </fieldset>
      <p className="form-help">Verify your email before scanning. One completed free report per email.</p>
      <button className="primary-button form-button" disabled={busy}>{busy ? "Sending your code…" : "Send verification code"}</button>
    </form> : <form onSubmit={event => submit(event, true)}>
      <label className="field">Verification code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} /></label>
      <button className="primary-button form-button" disabled={busy}>{busy ? "Verifying…" : "Verify my email"}</button>
      <p className="form-help">Didn’t get a code? Check your spam folder. You can request a new code after one minute.</p>
      <button type="button" className="text-button" disabled={busy} onClick={() => { setStatus({ state: "intake" }); setError(""); setCode(""); }}>Request a new code or change email</button>
    </form>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
