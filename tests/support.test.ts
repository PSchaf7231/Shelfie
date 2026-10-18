import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { testDatabase } from './helpers/postgres';
import { PostgresDatabase } from '../src/lib/postgres';
import { POST } from '../src/app/api/support/route';
import { SupportStore, SUPPORT_OWNER_EMAIL } from '../src/lib/support';

test('anonymous help is stored, routes only to the owner, strips screenshot metadata and retries failed email without duplicate messages',async()=>{
  const fixture=await testDatabase(),inspect=new PostgresDatabase(fixture.url);
  const previous={url:process.env.DATABASE_URL,key:process.env.EMAIL_PROVIDER_API_KEY,from:process.env.EMAIL_FROM,fetch:globalThis.fetch};
  process.env.DATABASE_URL=fixture.url;process.env.EMAIL_PROVIDER_API_KEY='test-placeholder';process.env.EMAIL_FROM='test@example.com';
  const screenshot=await sharp({create:{width:900,height:1200,channels:3,background:'navy'}}).withExif({IFD0:{Artist:'Private fixture'}}).jpeg().toBuffer();
  let calls=0,fail=true;
  globalThis.fetch=async(_url,options)=>{
    calls++;const body=JSON.parse(String(options?.body));
    assert.deepEqual(body.to,[SUPPORT_OWNER_EMAIL]);assert.equal(body.reply_to,'help-tester@example.com');
    assert.match(body.text,/Can you help with this photo/);assert.equal(body.attachments.length,1);
    assert.equal((await sharp(Buffer.from(body.attachments[0].content,'base64')).metadata()).exif,undefined);
    return Response.json(fail?{error:'unavailable'}:{id:'test-email'},{status:fail?503:200});
  };
  const reference=randomUUID();
  const request=(origin='http://localhost',id=reference,recipient='attacker@example.com')=>{
    const form=new FormData();form.set('name','Tester');form.set('email','HELP-TESTER@example.com');form.set('message','Can you help with this photo?');form.set('requestId',id);form.set('to',recipient);
    form.set('screenshot',new Blob([new Uint8Array(screenshot)],{type:'image/jpeg'}),'screen.jpg');
    return new NextRequest('http://localhost/api/support',{method:'POST',headers:{host:'localhost',origin},body:form});
  };
  try{
    assert.equal((await POST(request('https://elsewhere.example'))).status,403);assert.equal(calls,0);
    const first=await POST(request());assert.equal(first.status,200);assert.equal((await first.json()).emailState,'failed');
    let rows=await inspect.read(async db=>(await db.query('SELECT * FROM support_messages')).rows);
    assert.equal(rows.length,1);assert.equal(rows[0].email_state,'failed');assert.equal(rows[0].email,'help-tester@example.com');
    fail=false;const retry=await POST(request());assert.equal((await retry.json()).emailState,'accepted');assert.equal(calls,2);
    await POST(request());assert.equal(calls,2);
    rows=await inspect.read(async db=>(await db.query('SELECT * FROM support_messages')).rows);assert.equal(rows.length,1);assert.equal(rows[0].email_state,'accepted');
    assert.equal(await inspect.read(async db=>(await db.query('SELECT COUNT(*) AS total FROM sessions')).rows[0].total),'0');
    assert.equal(await inspect.read(async db=>(await db.query('SELECT COUNT(*) AS total FROM reports')).rows[0].total),'0');
  }finally{
    globalThis.fetch=previous.fetch;await inspect.close();await fixture.cleanup();
    for(const[key,value]of Object.entries({DATABASE_URL:previous.url,EMAIL_PROVIDER_API_KEY:previous.key,EMAIL_FROM:previous.from})){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
test('help messages validate input, preserve idempotency, and enforce a database-backed per-email rate limit',async()=>{
  const fixture=await testDatabase(),store=new SupportStore(fixture.url);
  const input={name:'Ada',email:'ada-help@example.com',message:'A test help message'};
  try{
    await assert.rejects(store.save({...input,email:'bad\r\nBcc: someone'}),/valid email/);
    const saved=await store.save(input);
    assert.equal((await store.save(input,saved.reference)).reference,saved.reference);
    await assert.rejects(store.save({...input,message:'Changed'},saved.reference),/new message/);
    await store.save(input);await store.save(input);
    await assert.rejects(store.save(input),/wait/);
  }finally{await store.close();await fixture.cleanup();}
});
