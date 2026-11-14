"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BarcodeProduct } from "@/lib/barcode";
import { readPhotoResponse } from "@/lib/photo-client";

type Detector = { detect(image: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type DetectorConstructor = { new(options: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> };
export default function BarcodeCapture({ disabled, revision }: { disabled: boolean; revision: number }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<{ product: BarcodeProduct; lookupId: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  function stop() {
    generation.current++;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setScanning(false);
  }
  useEffect(() => () => {
    generation.current++;
    stream.current?.getTracks().forEach(track => track.stop());
  }, []);
  useEffect(() => { if (disabled) stop(); }, [disabled]);
  async function scan() {
    stop(); setError(""); setNotice(""); setResult(null); setConfirmed(false);
    const run = generation.current;
    try {
      const Constructor = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
      if (!Constructor || !navigator.mediaDevices?.getUserMedia) throw new Error("Camera barcode scanning isn’t supported here. Enter the numbers beneath the barcode, or photograph the ingredients.");
      const supported = await Constructor.getSupportedFormats();
      const formats = ["ean_13", "ean_8", "upc_a", "itf"].filter(format => supported.includes(format));
      if (!formats.length) throw new Error("Enter the barcode numbers below or photograph the ingredients.");
      const detector = new Constructor({ formats });
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (run !== generation.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media; setScanning(true);
      // The video remains mounted so the stream can be attached immediately.
      video.current!.srcObject = media;
      await video.current!.play();
      const deadline = Date.now() + 30000;
      while (run === generation.current && Date.now() < deadline) {
        const found = await detector.detect(video.current!);
        if (run !== generation.current) return;
        // UPC-E needs expansion before lookup; manual entry remains available.
        const value = found.find(item => /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(item.rawValue))?.rawValue;
        if (value) { setCode(value); setNotice("Barcode captured. Choose Find product to look it up."); stop(); return; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (run === generation.current) { stop(); setNotice("Couldn’t capture it. Enter the barcode numbers, or photograph the ingredients."); }
    } catch (err) {
      if (run !== generation.current) return;
      stop(); setError(err instanceof Error && err.message.startsWith("Camera barcode") ? err.message : "We couldn’t use the camera. Enter the barcode numbers below or photograph the ingredients.");
    }
  }
  async function lookup(event: FormEvent) {
    event.preventDefault(); stop(); setBusy(true); setError(""); setNotice(""); setResult(null); setConfirmed(false);
    try {
      const data = await readPhotoResponse(await fetch("/api/barcode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "lookup", barcode: code }) }), "Barcode lookup is unavailable. Photograph the ingredients instead.") as { found: boolean; product: BarcodeProduct; lookupId: string; message?: string };
      if (data.found) setResult({ product: data.product, lookupId: data.lookupId });
      else setNotice(data.message || "Product not found. Photograph the ingredients instead.");
    } catch (err) { setError(err instanceof Error ? err.message : "Barcode lookup failed. Photograph the ingredients instead."); }
    finally { setBusy(false); }
  }
  async function openReport() {
    setBusy(true); setError("");
    try {
      await readPhotoResponse(await fetch("/api/barcode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", confirmed, lookupId: result?.lookupId, revision }) }), "We couldn’t prepare this product. Your free report hasn’t been used.");
      window.location.assign("/report");
    } catch (err) { setError(err instanceof Error ? err.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="barcode-panel" aria-labelledby="barcode-heading">
    <h2 id="barcode-heading">Scan barcode</h2>
    <p className="form-help">Look up the product, or use a photo of its ingredient list below.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="button" className="secondary-button" disabled={disabled || busy} onClick={scanning ? stop : scan}>{scanning ? "Stop camera" : "Scan barcode with camera"}</button>
    <video ref={video} hidden={!scanning} autoPlay muted playsInline className="barcode-video" aria-label="Barcode camera preview" />
    <form onSubmit={lookup}>
      <label htmlFor="barcode-number">Or enter the barcode numbers</label>
      <input id="barcode-number" value={code} inputMode="numeric" autoComplete="off" maxLength={40} disabled={disabled || busy || scanning} onChange={event => { setCode(event.target.value); setResult(null); setConfirmed(false); setNotice(""); }} />
      <button className="secondary-button" disabled={disabled || busy || scanning || !code.trim()}>{busy ? "Please wait…" : "Find product"}</button>
    </form>
    {notice && <p className="form-help" role="status">{notice}</p>}
    {result && <div className="barcode-result">
      <h3>{result.product.name}</h3><p>{result.product.brand}</p>
      <p className="form-help">Database ingredients may reflect an older formula. Check the product, variant and full list against your package. If anything differs, photograph the label instead.</p>
      <p className="barcode-ingredients">{result.product.ingredientsText}</p>
      <p className="form-help">Source: <a href={result.product.sourceUrl} target="_blank" rel="noopener noreferrer">Open Beauty Facts contributors</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">Open Database License</a></p>
      <label className="barcode-confirm"><input type="checkbox" checked={confirmed} disabled={busy || disabled} onChange={event => setConfirmed(event.target.checked)} /> This is my product and the full ingredients match my package.</label>
      <p className="form-help">Opening the completed report uses your one free report. A failed lookup does not.</p>
      <button className="primary-button form-button" disabled={!confirmed || disabled || busy} onClick={openReport}>{busy ? "Preparing your report…" : "Show my free report for this product"}</button>
    </div>}
  </section>;
}
