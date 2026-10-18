import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readIngredientLabel } from '../src/lib/label-reader';
const photo = { bytes: Buffer.from('fixture image'), width: 1000, height: 800 };
const transcript = (second='Glycerin') => ({rawText:`Aqua, ${second}`, complete:true,certain:true,confidence:0.99,ingredients:[{text:'Aqua',confidence:0.99},{text:second,confidence:0.99}]});
const response = (body: unknown) => Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(body)}}]});
test('independent reads must agree and every entry must have confident literal text', async () => {
  const previous=process.env.LABEL_READER_API_KEY; process.env.LABEL_READER_API_KEY='test-placeholder';
  const previousModel=process.env.LABEL_READER_MODEL; delete process.env.LABEL_READER_MODEL;
  try {
    let calls=0;
    const good=await readIngredientLabel([photo],async (_url,options)=>{
      calls++; const body=JSON.parse(String(options?.body));
      assert.equal(body.model,'gpt-4.1');
      assert.equal(body.response_format.json_schema.strict,true);
      assert.ok(!JSON.stringify(body.messages).includes('a prior transcription is'));
      return response(transcript());
    });
    assert.equal(calls,2); assert.equal(good.ingredients.length,2);
    calls=0;
    await assert.rejects(readIngredientLabel([photo],async()=>response(transcript(++calls===1?'Glycerin':'Retinol'))),/confirm every ingredient/);
    await assert.rejects(readIngredientLabel([photo],async()=>response({...transcript(),complete:false})),/reliably/);
    await assert.rejects(readIngredientLabel([photo],async()=>response({...transcript(),ingredients:[{text:'Aqua',confidence:0.99},{text:'Glycerin',confidence:0.6}]})),/reliably/);
    await assert.rejects(readIngredientLabel([photo],async()=>response({...transcript(),ingredients:[{text:'Aqua',confidence:0.99}]})),/reliably/);
    await assert.rejects(readIngredientLabel([photo],async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]})),/reliably/);
    await assert.rejects(readIngredientLabel([photo],async()=>Response.json({choices:[{finish_reason:'stop',message:{refusal:'refused'}}]})),/reliably/);
    await assert.rejects(readIngredientLabel([photo],async()=>{throw new Error('network');}),/unavailable/);
    await assert.rejects(readIngredientLabel([photo],async()=>new Response('',{status:429})),/unavailable/);
    delete process.env.LABEL_READER_API_KEY;
    await assert.rejects(readIngredientLabel([photo]),/unavailable/);
  } finally {
    if(previous===undefined)delete process.env.LABEL_READER_API_KEY;else process.env.LABEL_READER_API_KEY=previous;
    if(previousModel===undefined)delete process.env.LABEL_READER_MODEL;else process.env.LABEL_READER_MODEL=previousModel;
  }
});
test('independent reads may format the label heading differently but must agree on every ingredient character', async () => {
  const previous=process.env.LABEL_READER_API_KEY; process.env.LABEL_READER_API_KEY='test-placeholder';
  try {
    const body={rawText:'Aqua, Glycerin.',complete:true,certain:true,confidence:0.99,ingredients:[{text:'Aqua',confidence:0.99},{text:'Glycerin.',confidence:0.99}]};
    let calls=0;
    const good=await readIngredientLabel([photo],async()=>response({...body,rawText:++calls===1?'INGREDIENTS\nAqua, Glycerin.':body.rawText}));
    assert.equal(calls,2); assert.deepEqual(good.ingredients.map(item=>item.raw),['Aqua','Glycerin.']);
    calls=0;
    await assert.rejects(readIngredientLabel([photo],async()=>response(++calls===1?body:{...body,rawText:'Aqua, Glycerin',ingredients:[{text:'Aqua',confidence:0.99},{text:'Glycerin',confidence:0.99}]})),/confirm every ingredient/);
  } finally {if(previous===undefined)delete process.env.LABEL_READER_API_KEY;else process.env.LABEL_READER_API_KEY=previous;}
});
