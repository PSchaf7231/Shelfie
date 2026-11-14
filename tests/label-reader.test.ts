import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readIngredientLabel } from '../src/lib/label-reader';
const photo = { bytes: Buffer.from('fixture image'), width: 1000, height: 800 };
const transcript = () => ({rawText:'Aqua, Glycerin',complete:true,certain:true,confidence:0.94,ingredients:[{text:'Aqua',confidence:0.93},{text:'Glycerin',confidence:0.91}]});
const response = (body: unknown) => Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(body)}}]});
test('one photo is read once without a 98% cutoff', async () => {
  const previous=process.env.LABEL_READER_API_KEY; process.env.LABEL_READER_API_KEY='test-placeholder';
  try {
    let calls=0;
    const good=await readIngredientLabel([photo],async()=>{calls++;return response(transcript());});
    assert.equal(calls,1); assert.equal(good.ingredients.length,2);
    for(const invalid of [{...transcript(),complete:false},{...transcript(),certain:false},{...transcript(),ingredients:[{text:'Aqua',confidence:0.9}]},{...transcript(),rawText:'Aqua, ???'}]) {
      await assert.rejects(readIngredientLabel([photo],async()=>response(invalid)),/reliably/);
    }
    await assert.rejects(readIngredientLabel([photo],async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]})),/reliably/);
    await assert.rejects(readIngredientLabel([photo],async()=>Response.json({choices:[{finish_reason:'stop',message:{refusal:'refused'}}]})),/reliably/);
    await assert.rejects(readIngredientLabel([photo],async()=>{throw new Error('network');}),/unavailable/);
    await assert.rejects(readIngredientLabel([photo],async()=>new Response('',{status:429})),/unavailable/);
    delete process.env.LABEL_READER_API_KEY;
    await assert.rejects(readIngredientLabel([photo]),/unavailable/);
  } finally {if(previous===undefined)delete process.env.LABEL_READER_API_KEY;else process.env.LABEL_READER_API_KEY=previous;}
});
test('two separate photos are refused before calling the provider', async()=>{
  const previous=process.env.LABEL_READER_API_KEY;process.env.LABEL_READER_API_KEY='test-placeholder';
  try {let calls=0;await assert.rejects(readIngredientLabel([photo,photo],async()=>{calls++;return response(transcript());}));assert.equal(calls,0);}
  finally{if(previous===undefined)delete process.env.LABEL_READER_API_KEY;else process.env.LABEL_READER_API_KEY=previous;}
});
