"use client";
import { useEffect, useRef, useState } from "react";
import { skinTypes, skinConcerns, type SkinProfile } from "@/lib/skin-profile";

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: null | ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void); onerror: null | (() => void); onend: null | (() => void) };
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
export default function SkinProfileForm({ value, onChange }: { value: SkinProfile; onChange(value: SkinProfile): void }) {
  const current = useRef(value); current.current = value;
  const recognition = useRef<Recognition | null>(null);
  const [supported, setSupported] = useState(false), [listening, setListening] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => {
    const w = window as SpeechWindow; setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => { if (recognition.current) { recognition.current.onresult = null; recognition.current.onerror = null; recognition.current.onend = null; recognition.current.stop(); } };
  }, []);
  function dictate() {
    if (listening) { recognition.current?.stop(); return; }
    const w = window as SpeechWindow, Constructor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Constructor) return;
    const speech = new Constructor(); recognition.current = speech;
    speech.lang = navigator.language || "en-US"; speech.interimResults = false; speech.continuous = false;
    speech.onresult = event => {
      const words = Array.from(event.results).slice(event.resultIndex).map(result => result[0]?.transcript || "").join(" ");
      onChange({ ...current.current, note: `${current.current.note} ${words}`.trim().slice(0, 300) });
      setNotice("Dictation added. Check the words before continuing.");
    };
    speech.onerror = () => { setNotice("Dictation wasn’t available. Type your note or use the microphone on your phone’s keyboard."); setListening(false); };
    speech.onend = () => setListening(false);
    try { speech.start(); setListening(true); setNotice(""); }
    catch { setNotice("Use your phone’s keyboard microphone or type the note."); }
  }
  return <fieldset className="skin-profile-fields"><legend>Your skin (optional)</legend>
    <p className="form-help">Tell us how you describe your skin. These choices and your note will be saved with your report.</p>
    <div className="profile-chips" role="group" aria-label="Skin type">{Object.entries(skinTypes).map(([key, label]) => <button type="button" key={key} aria-pressed={value.type === key} onClick={() => onChange({ ...value, type: value.type === key ? "" : key as SkinProfile["type"] })}>{label}</button>)}</div>
    <div className="profile-chips" role="group" aria-label="Skin concerns">{Object.entries(skinConcerns).map(([key, label]) => <button type="button" key={key} aria-pressed={value.concerns.includes(key as SkinProfile["concerns"][number])} onClick={() => onChange({ ...value, concerns: value.concerns.includes(key as SkinProfile["concerns"][number]) ? value.concerns.filter(item => item !== key) : [...value.concerns, key as SkinProfile["concerns"][number]] })}>{label}</button>)}</div>
    <label className="field">Anything else? (optional)<input name="skinNote" maxLength={300} placeholder="For example: My cheeks get itchy." value={value.note} onChange={event => onChange({ ...value, note: event.target.value })} /></label>
    {supported ? <><button type="button" className="text-button" aria-pressed={listening} onClick={dictate}>{listening ? "Stop microphone" : "🎤 Dictate my note"}</button><p className="form-help">Your browser handles dictation. Shelfie saves the words you approve, not an audio recording.</p></> : <p className="form-help">You can also use the microphone on your phone’s keyboard to dictate your note.</p>}
    {notice && <p role="status" className="form-help">{notice}</p>}
  </fieldset>;
}
