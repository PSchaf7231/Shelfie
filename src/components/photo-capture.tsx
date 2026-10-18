"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { addLabelPhotos, PhotoClientError, photoBatchResponse, preparePhotoForUpload, readPhotoResponse, type Photo } from "@/lib/photo-client";
import { clearPhotoDraft, loadPhotoDraft, savePhotoDraft } from "@/lib/photo-draft";
import { MAX_PHOTOS } from "@/lib/photo-limits";

const LOAD_ERROR = "We couldn’t load your saved photos. Refresh this page to try again.";
const CHECK_ERROR = "We couldn’t check your photos this time. Your photos are still here, and your free report hasn’t been used. Please try again.";
const READ_ERROR = "We couldn’t finish reading this label. Your photos are still here, and your free report hasn’t been used. Please try again.";
const KEEP_OPEN = "Keep this page open until you check your photos.";

export default function PhotoCapture() {
  const camera = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());
  const current = useRef<Photo[]>([]);
  const savedRevision = useRef(0);
  const owner = useRef("");
  const retaking = useRef<string | undefined>(undefined);
  const selectionQueue = useRef(Promise.resolve());
  const draftQueue = useRef(Promise.resolve());
  const pendingSelections = useRef(0);
  const mounted = useRef(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [changed, setChanged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [locked, setLocked] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [shared, setShared] = useState<{ reference: string; selection: string } | null>(null);
  const reviewSelection = `${photos.map(photo => photo.id).join(",")}:${error}`;
  const working = busy || reading || preparing || sharing || loadFailed;

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const cameraInput = camera.current;
    const cancelled = () => { retaking.current = undefined; };
    cameraInput?.addEventListener("cancel", cancelled);
    (async () => {
      const response = await fetch("/api/photos", { cache: "no-store" });
      const batch = photoBatchResponse(await readPhotoResponse(response, LOAD_ERROR), LOAD_ERROR);
      const draft = await loadPhotoDraft(batch.draftKey, batch.revision).catch(() => undefined);
      if (!active) return;
      owner.current = batch.draftKey;
      savedRevision.current = batch.revision;
      let selected = batch.photos;
      if (draft && draft.photos.every(photo => photo.blob || batch.photos.some(saved => saved.id === photo.id))) {
        selected = draft.photos.map(photo => {
          if (!photo.blob) return batch.photos.find(saved => saved.id === photo.id)!;
          const file = new File([photo.blob], "ingredient-label.jpg", { type: "image/jpeg" });
          const url = URL.createObjectURL(file);
          urls.current.add(url);
          return { id: photo.id, url, file };
        });
        setChanged(true);
        setMessage(selected.length ? "Your unfinished photos are back. Add another angle or check them when you’re ready." : "Ready for a different product. Add its ingredient-label photos.");
      } else if (batch.photos.length) {
        setMessage("Your checked label photos are saved. Your free report is still available.");
      }
      current.current = selected;
      setPhotos(selected); setRevision(batch.revision);
    })().catch(error => {
      if (!active) return;
      setLoadFailed(true);
      if (error instanceof PhotoClientError && [401, 409].includes(error.status)) setLocked(true);
      setError(error instanceof PhotoClientError ? error.message : LOAD_ERROR);
    }).finally(() => { if (active) setLoading(false); });
    const ownedUrls = urls.current;
    return () => {
      active = false; mounted.current = false;
      cameraInput?.removeEventListener("cancel", cancelled);
      for (const url of ownedUrls) URL.revokeObjectURL(url);
      ownedUrls.clear();
    };
  }, []);

  function display(next: Photo[]) {
    for (const photo of current.current) if (photo.file && !next.some(item => item.url === photo.url)) {
      URL.revokeObjectURL(photo.url); urls.current.delete(photo.url);
    }
    current.current = next; setPhotos(next);
  }

  async function persist(next: Photo[] | null) {
    const key = owner.current;
    const base = savedRevision.current;
    const job = draftQueue.current.catch(() => {}).then(() => next === null ? clearPhotoDraft(key) : savePhotoDraft(key, base, next));
    draftQueue.current = job;
    try { await job; return true; } catch { return false; }
  }

  function openCamera(replaceId?: string) {
    retaking.current = replaceId;
    camera.current?.click();
  }

  function select(event: ChangeEvent<HTMLInputElement>, fromCamera = false) {
    const files = Array.from(event.target.files || []);
    const replaceId = fromCamera ? retaking.current : undefined;
    retaking.current = undefined;
    event.target.value = "";
    if (!files.length) return;
    pendingSelections.current++; setPreparing(true); setError(""); setMessage("");
    selectionQueue.current = selectionQueue.current.catch(() => {}).then(async () => {
      if (!mounted.current) return;
      if (!replaceId && current.current.length + files.length > MAX_PHOTOS) throw new PhotoClientError("Use up to six photos of the same product. Remove a photo before adding more.");
      const prepared: File[] = [];
      for (let i = 0; i < files.length; i++) {
        try { prepared.push(await preparePhotoForUpload(files[i])); }
        catch (error) {
          if (error instanceof PhotoClientError && files.length > 1) throw new PhotoClientError(`Photo ${i + 1}: ${error.message}`);
          throw error;
        }
      }
      if (!mounted.current) return;
      const incoming = prepared.map(file => {
        const url = URL.createObjectURL(file); urls.current.add(url);
        return { id: crypto.randomUUID(), url, file };
      });
      let next: Photo[];
      try { next = addLabelPhotos(current.current, incoming, replaceId); }
      catch (error) { for (const photo of incoming) { URL.revokeObjectURL(photo.url); urls.current.delete(photo.url); } throw error; }
      display(next); setChanged(true);
      const stored = await persist(next);
      if (mounted.current) setMessage(stored ? (replaceId ? "Retake added. Your other photos are still here." : "Photo added. You can add another angle of this same product.") : KEEP_OPEN);
    }).catch(error => {
      if (mounted.current) setError(error instanceof PhotoClientError ? error.message : "We couldn’t add this photo. Your other photos are still here. Please try again.");
    }).finally(() => {
      pendingSelections.current--;
      if (mounted.current && pendingSelections.current === 0) setPreparing(false);
    });
  }

  async function changeSelection(next: Photo[], notice: string) {
    setPreparing(true); setError("");
    display(next); setChanged(true);
    const stored = await persist(next);
    if (mounted.current) { setPreparing(false); setMessage(stored ? notice : KEEP_OPEN); }
  }

  async function rotatePhoto(photo: Photo) {
    setPreparing(true); setError(""); setMessage("");
    try {
      let file = photo.file;
      if (!file) {
        const response = await fetch(photo.url, { cache: "no-store" });
        if (!response.ok) throw new PhotoClientError("We couldn’t open this saved photo. Your other photos are still here.");
        file = new File([await response.blob()], "ingredient-label.jpg", { type: "image/jpeg" });
      }
      const turned = await preparePhotoForUpload(file, true);
      if (!mounted.current) return;
      const url = URL.createObjectURL(turned); urls.current.add(url);
      const next = addLabelPhotos(current.current, [{ id: crypto.randomUUID(), url, file: turned }], photo.id);
      display(next); setChanged(true);
      const stored = await persist(next);
      if (mounted.current) setMessage(stored ? "Photo rotated. Your other photos are still here. Upload and check when you’re ready." : KEEP_OPEN);
    } catch (error) { if (mounted.current) setError(error instanceof PhotoClientError ? error.message : "We couldn’t rotate this photo. Your photos are still here."); }
    finally { if (mounted.current) setPreparing(false); }
  }

  async function check() {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = new FormData();
      body.set("revision", String(savedRevision.current));
      body.set("existingIds", JSON.stringify(current.current.filter(photo => !photo.file).map(photo => photo.id)));
      for (const photo of current.current) if (photo.file) body.append("photos", photo.file);
      const response = await fetch("/api/photos", { method: "POST", body });
      const batch = photoBatchResponse(await readPhotoResponse(response, CHECK_ERROR), CHECK_ERROR);
      if (!mounted.current) return;
      display(batch.photos); savedRevision.current = batch.revision; owner.current = batch.draftKey;
      setRevision(batch.revision); setChanged(false);
      setMessage(batch.message || "Your label photos are checked and saved. Your free report is still available.");
      await persist(null);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof PhotoClientError && error.status === 401) setLocked(true);
      setError(error instanceof PhotoClientError ? error.message : CHECK_ERROR);
    } finally { if (mounted.current) setBusy(false); }
  }

  async function openReport() {
    setReading(true); setError("");
    try {
      const response = await fetch("/api/ingredients", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: savedRevision.current }),
      });
      const data = await readPhotoResponse(response, READ_ERROR);
      if (!data || typeof data !== "object") throw new PhotoClientError(READ_ERROR);
      window.location.assign("/report");
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof PhotoClientError && error.status === 401) setLocked(true);
      setError(error instanceof PhotoClientError ? error.message : READ_ERROR);
    } finally { if (mounted.current) setReading(false); }
  }

  async function shareForReview() {
    setSharing(true); setReviewError("");
    try {
      const body = new FormData();
      body.set("revision", String(savedRevision.current));
      body.set("existingIds", JSON.stringify(current.current.filter(photo => !photo.file).map(photo => photo.id)));
      body.set("reviewConsent", "photo-review-v1");
      body.set("reviewReason", error);
      for (const photo of current.current) if (photo.file) body.append("photos", photo.file);
      const fallback = "We couldn’t share these photos. Your photos and free report are unchanged. Please try again.";
      const data = await readPhotoResponse(await fetch("/api/photo-reviews", { method: "POST", body }), fallback) as { reference?: string };
      if (!data || !/^[a-f0-9-]{36}$/.test(data.reference || "")) throw new PhotoClientError(fallback);
      if (mounted.current) setShared({ reference: data.reference!, selection: reviewSelection });
    } catch (error) {
      if (mounted.current) setReviewError(error instanceof PhotoClientError ? error.message : "Photo sharing is unavailable. Your photos are still here.");
    } finally { if (mounted.current) setSharing(false); }
  }

  async function deleteReview() {
    if (!shared) return;
    setSharing(true); setReviewError("");
    try {
      await readPhotoResponse(await fetch("/api/photo-reviews", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: shared.reference }) }), "We couldn’t delete the shared copy. Please try again.");
      if (mounted.current) setShared(null);
    } catch (error) { if (mounted.current) setReviewError(error instanceof PhotoClientError ? error.message : "We couldn’t delete the shared copy. Please try again."); }
    finally { if (mounted.current) setSharing(false); }
  }

  return <section className="intake-panel">
    <h1>Let’s see the label.</h1>
    <p className="form-intro">Photograph the ingredient list of one product.</p>
    <p className="photo-guide">Use bright, even light without a shadow or glare. Fill the frame with the ingredient list. Rest your phone or elbows on a steady surface if that helps.</p>
    <p className="form-help">Curved bottle or long list? Take one clear photo, turn the bottle a little, then add another. Include a few of the same words in both photos so we can follow the whole list.</p>
    <input ref={camera} id="camera-photo" className="visually-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={event => select(event, true)} />
    <input ref={upload} id="phone-photos" className="visually-hidden" type="file" accept="image/*" multiple tabIndex={-1} aria-hidden="true" onChange={event => select(event)} />
    <div className="capture-actions">
      <button className="primary-button form-button" disabled={working || loading || locked || photos.length >= MAX_PHOTOS} onClick={() => openCamera()}>{preparing ? "Adding your photo…" : photos.length ? "Take another photo" : "Take a photo"}</button>
      <button className="secondary-button" disabled={working || loading || locked || photos.length >= MAX_PHOTOS} onClick={() => { retaking.current = undefined; upload.current?.click(); }}>{photos.length ? "Add photos from phone" : "Upload from phone"}</button>
    </div>
    {loading && <p role="status" className="form-help">Loading your photos…</p>}
    {!!photos.length && <>
      <p className="photo-count" aria-live="polite">{photos.length} {photos.length === 1 ? "photo" : "photos"} of this product</p>
      <ol className="photo-list">{photos.map((photo, index) => <li key={photo.id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={`Label photo ${index + 1}`} />
        <div><span>Photo {index + 1}</span><div className="photo-controls">
          <button className="text-button" disabled={working || locked} onClick={() => openCamera(photo.id)} aria-label={`Retake photo ${index + 1}`}>Retake</button>
          <button className="text-button" disabled={working || locked} onClick={() => rotatePhoto(photo)} aria-label={`Rotate photo ${index + 1}`}>Rotate</button>
          <button className="text-button" disabled={working || locked} onClick={() => changeSelection(current.current.filter(item => item.id !== photo.id), "Photo removed. Your other photos are still here.")} aria-label={`Remove photo ${index + 1}`}>Remove</button>
        </div></div>
      </li>)}</ol>
      <button className="text-button" disabled={working || locked} onClick={() => changeSelection([], "Ready for a different product. Add its ingredient-label photos.")}>Start a different product</button>
      <button className="primary-button form-button" disabled={working || loading || locked} onClick={check}>{busy ? "Uploading and checking…" : `Upload and check ${photos.length === 1 ? "this photo" : `these ${photos.length} photos`}`}</button>
      {revision > 0 && !changed && <div className="report-next">
        <p className="form-help">Your first report is free. Showing the completed report uses the one free report for this email.</p>
        <button className="primary-button form-button" disabled={working || loading || locked} onClick={openReport}>{reading ? "Reading every ingredient…" : "Show my free report"}</button>
      </div>}
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {error && !!photos.length && !locked && <div className="photo-review">
      <p className="form-help">Think this photo should work? You can share these label photos and the message with Shelfie’s support team for troubleshooting. The shared copy is private and available for review for 24 hours. Sharing is optional and never uses your free report.</p>
      <button className="secondary-button" disabled={working || shared?.selection === reviewSelection} onClick={shareForReview}>{sharing ? "Sharing…" : shared?.selection === reviewSelection ? "Shared for review" : "Share photos for review"}</button>
    </div>}
    {shared && <div className="photo-review-receipt" role="status">
      <p>Shared for review. This does not send a reply automatically. If you contact us, include this reference: <span className="review-reference">{shared.reference}</span></p>
      <button className="text-button" disabled={working} onClick={deleteReview}>Delete shared copy</button>
    </div>}
    {reviewError && <p className="form-error" role="alert">{reviewError}</p>}
    {message && <p className="photo-success" role="status">{message}</p>}
    {locked && <a className="back-link" href="/intake">Return to email verification</a>}
    <p className="form-help">Retakes never use your free report. We’ll ask for clearer photos if we can’t read the label. Photos are sent securely to our vision provider for label checks and reading. Checked photos are private and available for 24 hours.</p>
  </section>;
}
