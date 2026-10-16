"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

type Photo = { id: string; url: string; file?: File };
export default function PhotoCapture() {
  const camera = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [changed, setChanged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [locked, setLocked] = useState(false);
  const working = busy || reading;

  useEffect(() => {
    let active = true;
    fetch("/api/photos", { cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok) {
        if (active && [401, 409].includes(response.status)) setLocked(true);
        throw new Error(data.error || "Couldn’t load your saved photos. Refresh to try again.");
      }
      if (active) { setPhotos(data.photos); setRevision(data.revision); if (data.photos.length) setMessage("Your label photos are saved. Your free report is still available."); }
    }).catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    const ownedUrls = urls.current;
    return () => { active = false; for (const url of ownedUrls) URL.revokeObjectURL(url); ownedUrls.clear(); };
  }, []);

  function select(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = ""; // permits selecting the same file for a retake
    setError(""); setMessage("");
    if (files.length + photos.length > 6) { setError("Use up to six photos of one product. Remove a photo before adding more."); return; }
    if (files.some(file => file.size > 6 * 1024 * 1024)) { setError("Each photo must be 6 MB or smaller. Please choose a smaller photo."); return; }
    if (files.length) setChanged(true);
    setPhotos(current => [...current, ...files.map(file => { const url = URL.createObjectURL(file); urls.current.add(url); return { id: crypto.randomUUID(), url, file }; })]);
  }
  function remove(photo: Photo) {
    if (photo.file) { URL.revokeObjectURL(photo.url); urls.current.delete(photo.url); }
    setPhotos(current => current.filter(item => item.id !== photo.id)); setChanged(true); setMessage(""); setError("");
  }
  async function check() {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = new FormData();
      body.set("revision", String(revision));
      body.set("existingIds", JSON.stringify(photos.filter(photo => !photo.file).map(photo => photo.id)));
      for (const photo of photos) if (photo.file) body.append("photos", photo.file);
      const response = await fetch("/api/photos", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) setLocked(true);
        if (response.status === 409) setError((data.error || "Your photos changed.") + " Refresh to continue.");
        throw new Error(data.error || "Couldn’t check your photos. Please try again.");
      }
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear(); setPhotos(data.photos); setRevision(data.revision); setChanged(false); setMessage(data.message);
    } catch (error) { setError(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  async function openReport() {
    setReading(true); setError("");
    try {
      const response = await fetch("/api/ingredients", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) setLocked(true);
        throw new Error(data.error || "We couldn’t read your label. Please try again; your free report is unchanged.");
      }
      window.location.assign("/report");
    } catch (error) { setError(error instanceof Error ? error.message : "Please try again."); }
    finally { setReading(false); }
  }
  return <section className="intake-panel">
    <h1>Let’s see the label.</h1>
    <p className="form-intro">One product at a time. Clear photos help us read every word.</p>
    <p className="photo-guide">Keep the label flat and facing the camera. Use bright light with no shadow. Get the whole ingredient list in frame.</p>
    <p className="form-help">Long or curved label? Add overlapping photos of the same product so the whole list is covered. Changes are saved only after a successful check.</p>
    <input ref={camera} className="visually-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={select} />
    <input ref={upload} className="visually-hidden" type="file" accept="image/*" multiple tabIndex={-1} aria-hidden="true" onChange={select} />
    <div className="capture-actions">
      <button className="primary-button form-button" disabled={working || loading || locked} onClick={() => camera.current?.click()}>Take a photo</button>
      <button className="secondary-button" disabled={working || loading || locked} onClick={() => upload.current?.click()}>Upload from phone</button>
    </div>
    {loading && <p role="status" className="form-help">Loading your photos…</p>}
    {!!photos.length && <>
      <ol className="photo-list">{photos.map((photo, index) => <li key={photo.id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={`Label photo ${index + 1}`} />
        <div><span>Photo {index + 1}</span><button className="text-button" disabled={working || locked} onClick={() => remove(photo)} aria-label={`Remove photo ${index + 1}`}>Remove / retake</button></div>
      </li>)}</ol>
      <button className="primary-button form-button" disabled={working || loading || locked} onClick={check}>{busy ? "Checking your photos…" : "Check label photos"}</button>
      {revision > 0 && !changed && <div className="report-next">
        <p className="form-help">Your first report is free. Showing the completed report uses the one free report for this email.</p>
        <button className="primary-button form-button" disabled={working || loading || locked} onClick={openReport}>{reading ? "Reading every ingredient…" : "Show my free report"}</button>
      </div>}
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="photo-success" role="status">{message}</p>}
    {locked && <a className="back-link" href="/intake">Return to email verification</a>}
    <p className="form-help">Retakes never use your free report. Photos are sent securely to our vision provider for readability checks and label reading. Accepted photos are private and available for 24 hours.</p>
  </section>;
}
