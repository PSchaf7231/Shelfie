import assert from "node:assert/strict";
import { mkdtemp,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import sharp from "sharp";

async function main(){
  const dir=await mkdtemp(join(tmpdir(),"shelfie-profile-help-"));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  let server:ReturnType<typeof createServer>|undefined;
  try{
    await build({stdin:{contents:'import React from "react";import{createRoot}from"react-dom/client";import IntakeForm from"./src/components/intake-form";import HelpButton from"./src/components/help-button";createRoot(document.getElementById("root")).render(<><IntakeForm initialPregnancy={false}/><HelpButton/></>);',loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'esm',outfile:join(dir,'app.js'),tsconfig:'tsconfig.json'});
    const js=await readFile(join(dir,'app.js')),css=await readFile('src/app/globals.css','utf8');
    server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(js);}else{res.setHeader('content-type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="intake-shell"><div id="root"></div></main><script type="module" src="/app.js"></script></body></html>`);}});
    await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
    const origin=`http://127.0.0.1:${address.port}`;
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await context.addInitScript({content:`window.SpeechRecognition=class { constructor(){this.lang='';this.interimResults=false;this.continuous=false;this.onresult=null;this.onerror=null;this.onend=null;} start(){window.micStarts=(window.micStarts||0)+1;setTimeout(()=>{if(this.onresult)this.onresult({resultIndex:0,results:[[{transcript:'My cheeks get itchy.'}]]});if(this.onend)this.onend();},30);} stop(){if(this.onend)this.onend();} };`});
    const page=await context.newPage();const pageErrors:string[]=[];page.on('pageerror',e=>pageErrors.push(e.message));
    let submitted:any,helpCalls=0,firstReference='';
    await page.route('**/api/intake/status',route=>route.fulfill({json:{state:'intake'}}));
    await page.route('**/api/intake',route=>{submitted=route.request().postDataJSON();return route.fulfill({json:{state:'pending',email:submitted.email}});});
    await page.route('**/api/verify-email',route=>route.fulfill({json:{state:'verified',email:submitted.email,eligible:true,pregnancy:false,glp1:false,skinProfile:submitted.skinProfile}}));
    await page.route('**/api/support',async route=>{
      const req=new Request(origin+'/api/support',{method:'POST',headers:{'content-type':route.request().headers()['content-type']},body:new Uint8Array(route.request().postDataBuffer()!)});
      const form=await req.formData();assert.equal(form.get('name'),'Help tester');assert.equal(form.get('email'),'help@example.com');assert.equal(form.get('message'),'Please help with a label photo.');
      const file=form.get('screenshot')as File;assert.ok(file.size<=600000);assert.equal((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).exif,undefined);
      const id=String(form.get('requestId'));if(!firstReference)firstReference=id;assert.equal(id,firstReference);helpCalls++;
      await route.fulfill({json:{reference:id,emailState:helpCalls===1?'failed':'accepted'}});
    });
    await page.goto(origin);await page.getByRole('button',{name:'Dry',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>(window as any).micStarts||0),0);
    await page.getByRole('button',{name:'Dry',exact:true}).click();await page.getByRole('button',{name:'Sensitive',exact:true}).click();await page.getByRole('button',{name:'Fragrance allergy',exact:true}).click();
    await page.getByRole('button',{name:'Dictate my note',exact:false}).click();await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[name="skinNote"]')?.value.includes('cheeks get itchy'));
    await page.getByRole('textbox',{name:'Name',exact:true}).fill('Skin tester');await page.getByRole('textbox',{name:'Email',exact:true}).fill('skin@example.com');
    await page.getByRole('button',{name:'Send verification code',exact:true}).click();await page.getByRole('textbox',{name:'Verification code',exact:true}).waitFor();
    assert.equal(submitted.skinProfile.type,'dry');assert.deepEqual(submitted.skinProfile.concerns,['sensitive','fragrance_allergy']);assert.equal(submitted.skinProfile.note,'My cheeks get itchy.');assert.equal(submitted.glp1,false);
    await page.getByRole('textbox',{name:'Verification code',exact:true}).fill('123456');await page.getByRole('button',{name:'Verify my email',exact:true}).click();await page.getByRole('link',{name:'Photograph my label'}).waitFor();
    console.log('PASS: skin choices and explicitly started dictation travel through signup and verification with GLP-1 off');
    const help=page.getByRole('button',{name:'Help / Message us',exact:true});await help.click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();assert.match(await dialog.innerText(),/paulschafranick@gmail.com/);
    await dialog.getByRole('textbox',{name:'Name',exact:true}).fill('Help tester');await dialog.getByRole('textbox',{name:'Your email',exact:true}).fill('help@example.com');await dialog.getByRole('textbox',{name:'Message',exact:true}).fill('Please help with a label photo.');
    const image=await sharp({create:{width:220,height:320,channels:3,background:'navy'}}).withExif({IFD0:{Artist:'Private screenshot metadata'}}).jpeg().toBuffer();
    await dialog.locator('input[type=file]').setInputFiles({name:'small-screen.jpg',mimeType:'image/jpeg',buffer:image});await dialog.getByText('One screenshot attached.',{exact:false}).waitFor();
    await dialog.getByRole('button',{name:'Send message to Paul',exact:true}).click();await dialog.getByRole('button',{name:'Retry email',exact:true}).waitFor();
    assert.match(await dialog.innerText(),/message is saved/);await dialog.getByRole('button',{name:'Retry email',exact:true}).click();await dialog.getByText('submitted for email delivery',{exact:false}).waitFor();assert.equal(helpCalls,2);
    await page.setViewportSize({width:320,height:844});assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await help.evaluate(el=>el===document.activeElement),true);
    console.log('PASS: Help names the owner, accepts a small screenshot, strips metadata, retries delivery with one reference, and keeps mobile layout/focus');
    const other=await browser.newContext({viewport:{width:320,height:844}});await other.addInitScript({content:'window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;'});const fallback=await other.newPage();await fallback.route('**/api/intake/status',route=>route.fulfill({json:{state:'intake'}}));await fallback.goto(origin);await fallback.getByText('microphone on your phone’s keyboard',{exact:false}).waitFor();assert.equal(await fallback.locator('[name=skinNote]').isEditable(),true);
    assert.deepEqual(pageErrors,[]);console.log('PASS: browsers without dictation keep a usable typed-note/keyboard-microphone fallback. No real emails were sent.');
  }finally{await browser.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
