"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { PhotoClientError, preparePhotoForUpload, readPhotoResponse } from "@/lib/photo-client";

export default function HelpButton({ label = "Help / Message us", context = "" }: { label?: string; context?: string }) {
  const dialog = useRef<HTMLDialogElement>(null), requestId = useRef("");
  const heading = useId();
  const [name,setName]=useState(""),[email,setEmail]=useState(""),[message,setMessage]=useState(""),[website,setWebsite]=useState("");
  const [screenshot,setScreenshot]=useState<File | undefined>(undefined),[busy,setBusy]=useState(false),[preparing,setPreparing]=useState(false),[error,setError]=useState("");
  const [result,setResult]=useState<{reference:string;emailState:string}|null>(null);
  function open() {
    if(!requestId.current)requestId.current=crypto.randomUUID();
    if(!message && context)setMessage(context.slice(0,2000));
    dialog.current?.showModal();
  }
  async function choose(file?:File) {
    if(!file){setScreenshot(undefined);return;}
    setPreparing(true);setError("");
    try {setScreenshot(await preparePhotoForUpload(file,false,true));}
    catch(e){setError(e instanceof Error?e.message:"We couldn’t open that screenshot.");}
    finally{setPreparing(false);}
  }
  async function send(event?:FormEvent) {
    event?.preventDefault();setBusy(true);setError("");
    try {
      const body=new FormData();body.set("name",name);body.set("email",email);body.set("message",message);body.set("website",website);body.set("requestId",requestId.current);
      if(screenshot)body.set("screenshot",screenshot);
      const fallback="We couldn’t send your message. Please try again or call 561-255-7285.";
      const data=await readPhotoResponse(await fetch("/api/support",{method:"POST",body}),fallback) as {reference:string;emailState:string};
      if(!data || !/^[a-f0-9-]{36}$/.test(data.reference)||!["accepted","failed"].includes(data.emailState))throw new PhotoClientError(fallback);
      setResult(data);
    }catch(e){setError(e instanceof Error?e.message:"We couldn’t send your message. Please try again.");}
    finally{setBusy(false);}
  }
  return <>
    <button type="button" className="text-button help-open" onClick={open}>{label}</button>
    <dialog ref={dialog} className="help-dialog" aria-labelledby={heading}>
      <div className="help-dialog-top"><h2 id={heading}>Message Shelfie’s owner</h2><button type="button" className="text-button" aria-label="Close help" onClick={()=>dialog.current?.close()}>Close</button></div>
      <p className="form-help">Your message and optional screenshot go to Paul at <a href="mailto:paulschafranick@gmail.com">paulschafranick@gmail.com</a> and are saved for follow-up. No email verification is needed to ask for help.</p>
      {!result ? <form onSubmit={send}>
        <label className="field">Name<input autoComplete="name" required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label>
        <label className="field">Your email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label className="field">Message<textarea required rows={4} maxLength={2000} value={message} onChange={e=>setMessage(e.target.value)}/></label>
        <label className="visually-hidden" aria-hidden="true">Leave this empty<input tabIndex={-1} autoComplete="off" value={website} onChange={e=>setWebsite(e.target.value)}/></label>
        <label className="field">Screenshot (optional)<input type="file" accept="image/*" disabled={preparing||busy} onChange={e=>{void choose(e.target.files?.[0]);e.target.value="";}}/></label>
        {screenshot&&<p className="form-help">One screenshot attached. <button type="button" className="text-button" onClick={()=>setScreenshot(undefined)}>Remove screenshot</button></p>}
        <button className="primary-button form-button" disabled={busy||preparing}>{preparing?"Preparing screenshot…":busy?"Sending…":"Send message to Paul"}</button>
      </form>:<div role="status">
        <p>{result.emailState==="accepted"?"Your message is saved and has been submitted for email delivery to Paul. A reply is not automatic.":"Your message is saved, but we couldn’t confirm email delivery to Paul. Retry below or call 561-255-7285."}</p>
        <p className="review-reference">Reference: {result.reference}</p>
        {result.emailState==="failed"&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void send()}>{busy?"Retrying…":"Retry email"}</button>}
        <button type="button" className="text-button" disabled={busy} onClick={()=>{setResult(null);setMessage("");setScreenshot(undefined);requestId.current=crypto.randomUUID();}}>Start another message</button>
      </div>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <p className="form-help"><a href="tel:+15612557285">Call Paul: 561-255-7285</a></p>
    </dialog>
  </>;
}
