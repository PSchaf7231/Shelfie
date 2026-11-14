import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { normalizeBarcode, lookupBarcode } from '../src/lib/barcode';
import { testDatabase } from './helpers/postgres';
import { intakeStore } from '../src/lib/intake';
import { POST } from '../src/app/api/barcode/route';
import { CATALOG_VERSION } from '../src/lib/ingredients/catalog';
import { isReportAnalysis } from '../src/lib/report';

function validCode(prefix:string) {let total=0;for(let i=prefix.length-1,w=3;i>=0;i--,w=w===3?1:3)total+=Number(prefix[i])*w;return prefix+((10-total%10)%10);}
const barcode=validCode('360052379002');
const product={code:barcode,product_name:'Test Moisturizer',brands:'Fixture',ingredients_text:'Aqua, Glycerin, Retinyl Palmitate',last_modified_t:1700000000};
test('barcode validates check digits and looks up only a matching usable cosmetic record',async()=>{
  assert.equal(normalizeBarcode(barcode),barcode);
  for(const bad of ['123','https://example.com',barcode.slice(0,-1)+(Number(barcode.at(-1))+1)%10,123])assert.throws(()=>normalizeBarcode(bad));
  assert.ok(await lookupBarcode(barcode,async(url,options)=>{
    assert.match(String(url),/^https:\/\/world.openbeautyfacts.org\/api\/v3\/product\//);
    assert.equal(options?.redirect,'error');return Response.json({product});
  }));
  for(const data of [{},{product:{...product,ingredients_text:''}},{product:{...product,code:'123'}},{product:{...product,ingredients_text:'Aqua, ???'}},{product:{...product,product_name:''}}])assert.equal(await lookupBarcode(barcode,async()=>Response.json(data)),null);
  assert.equal(await lookupBarcode(barcode,async()=>new Response('',{status:404})),null);
  await assert.rejects(lookupBarcode(barcode,async()=>new Response('',{status:429})),/unavailable/);
  await assert.rejects(lookupBarcode(barcode,async()=>{throw new Error('timeout');}),/unavailable/);
});
test('lookup and confirmation preserve credit, reject forged and stale selections, and save source in the completed report',async()=>{
  const fixture=await testDatabase();const before={db:process.env.DATABASE_URL,fetch:globalThis.fetch};process.env.DATABASE_URL=fixture.url;
  const store=intakeStore();
  async function user(email:string){const start=await store.create({name:'Tester',email,pregnancy:true,glp1:false});return store.verify(start.token,start.code);}
  const token=await user('barcode@example.com'),other=await user('barcode-other@example.com');
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({product});};
  const req=(who:string,body:unknown)=>new NextRequest('http://localhost/api/barcode',{method:'POST',headers:{host:'localhost',origin:'http://localhost','content-type':'application/json',cookie:`shelfie_session=${who}`},body:JSON.stringify(body)});
  try{
    assert.equal((await POST(req('',{action:'lookup',barcode}))).status,401);assert.equal(calls,0);
    const found=await POST(req(token,{action:'lookup',barcode}));assert.equal(found.status,200);
    const preview=await found.json();assert.equal(preview.found,true);
    assert.equal((await store.requireEligible(token)).eligible,true);
    const confirm={action:'confirm',confirmed:true,lookupId:preview.lookupId,revision:0};
    assert.equal((await POST(req(other,confirm))).status,409);
    assert.equal((await POST(req(token,{...confirm,confirmed:false}))).status,400);
    assert.equal((await POST(req(token,{...confirm,ingredients_text:'Retinol'}))).status,400);
    assert.equal((await POST(req(token,{...confirm,revision:1}))).status,409);
    assert.equal((await POST(req(token,confirm))).status,200);
    assert.equal(calls,1,'confirmation uses the exact stored lookup, not another database response');
    assert.equal((await store.requireEligible(token)).eligible,true);
    const draft=await store.ingredientAnalysis(token,1,CATALOG_VERSION);assert.ok(draft);assert.ok(isReportAnalysis(draft));
    assert.equal(draft.ingredientOrigin?.product.barcode,barcode);
    assert.ok(draft.ingredients[2].flags.some(flag=>flag.kind==='pregnancy_nursing'));
    const report=await store.completeIngredientReport(token,1,CATALOG_VERSION);
    assert.equal(report.analysis.ingredientOrigin?.product.name,'Test Moisturizer');
    assert.equal((await store.status(token)).state,'verified');
    assert.equal((await store.getReport(token))?.id,report.id);
    assert.equal((await store.completeIngredientReport(token,1,CATALOG_VERSION)).id,report.id);
    assert.equal((await POST(req(token,{action:'lookup',barcode}))).status,409);
    const next=await lookupBarcode(barcode,async()=>Response.json({product}));assert.ok(next);
    const id=await store.saveBarcodeLookup(other,next);
    await store.savePhotos(other,0,[{bytes:Buffer.from('fixture'),width:1000,height:800}]);
    await assert.rejects(store.useBarcodeLookup(other,id,0),/changed/);
    await assert.rejects(store.useBarcodeLookup(other,id,1,Date.now()+600001),/expired/);
    await store.useBarcodeLookup(other,id,1);
    assert.equal((await store.photoBatch(other)).photos.length,0);
    await store.savePhotos(other,2,[{bytes:Buffer.from('fixture'),width:1000,height:800}]);
    assert.equal((await store.photoBatch(other)).ingredientOrigin,null);
    assert.equal(await store.ingredientAnalysis(other,3,CATALOG_VERSION),null);
  }finally{globalThis.fetch=before.fetch;await store.close();await fixture.cleanup();if(before.db===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=before.db;}
});
