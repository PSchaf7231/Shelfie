import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { skinProfile } from '../src/lib/skin-profile';
import { analyzeIngredients } from '../src/lib/ingredients/analyze';
import { isReportAnalysis } from '../src/lib/report';
import ReportContent from '../src/components/report-content';
import { testDatabase } from './helpers/postgres';

const label = ['Glycerin','Parfum','Alcohol Denat.','Unlisted Extract'];
const transcript = { rawText:label.join(', '),complete:true,certain:true,confidence:0.99,ingredients:label.map(text=>({text,confidence:0.99})) };
const profile = skinProfile({type:'dry',concerns:['fragrance_allergy','sensitive'],note:'My cheeks get itchy.'});
test('skin-profile choices validate, remain optional, and produce general cautions with the medication mode off',()=>{
  assert.deepEqual(skinProfile(),{type:'',concerns:[],note:''});
  for(const bad of [{type:'diagnosed-from-selfie'},{concerns:['invented']},{concerns:['sensitive','sensitive']},{note:'x'.repeat(301)},{medicalDiagnosis:'eczema'}])assert.throws(()=>skinProfile(bad));
  const analysis=analyzeIngredients(transcript,{pregnancy:false,glp1:false},profile);
  assert.ok(analysis.skinGuidance?.some(note=>note.includes('Glycerin')&&note.includes('moisture')));
  assert.ok(analysis.skinGuidance?.some(note=>note.includes('Parfum')&&note.includes('allergy')));
  assert.ok(analysis.skinGuidance?.some(note=>note.includes('Alcohol Denat.')&&note.includes('drying')));
  assert.ok(analysis.skinGuidance?.some(note=>note.includes('incomplete')));
  assert.equal(isReportAnalysis(analysis),true);
  assert.equal(isReportAnalysis({...analysis,skinGuidance:['This formula cures eczema.']}),false);
  const html=renderToStaticMarkup(createElement(ReportContent,{report:{id:'skin-report',completed:Date.now(),analysis}}));
  assert.match(html,/For the skin you described/);assert.match(html,/My cheeks get itchy/);assert.match(html,/Fragrance allergy/);
});
test('skin profile survives verification and restart, invalidates mismatched drafts, and is saved with the immutable report',async()=>{
  const fixture=await testDatabase();let store=fixture.connect();
  try{
    const input={name:'Profile tester',email:'skin-profile@example.com',pregnancy:false,glp1:false,skinProfile:profile};
    const pending=await store.create(input);const token=await store.verify(pending.token,pending.code);
    assert.deepEqual((await store.requireEligible(token)).skinProfile,profile);
    await store.savePhotos(token,0,[{bytes:Buffer.from('previously accepted photo'),width:900,height:1000}]);
    const wrong=analyzeIngredients(transcript,{pregnancy:false,glp1:false});
    await assert.rejects(store.saveIngredientAnalysis(token,1,wrong),/skin profile changed/);
    const analysis=analyzeIngredients(transcript,{pregnancy:false,glp1:false},profile);
    await store.saveIngredientAnalysis(token,1,analysis);
    await store.updateSkinProfile(token,{...profile,note:'A changed note.'});
    assert.equal(await store.ingredientAnalysis(token,1,analysis.catalogVersion),null);
    assert.equal((await store.photoBatch(token)).photos.length,1);
    assert.equal((await store.requireEligible(token)).eligible,true);
    await store.updateSkinProfile(token,profile);await store.saveIngredientAnalysis(token,1,analysis);
    const later=Date.now()+60001;
    const changed=await store.create({...input,skinProfile:skinProfile({type:'oily'})},later);
    const other=await store.verify(changed.token,changed.code,later);
    assert.equal(await store.ingredientAnalysis(other,1,analysis.catalogVersion,later),null);
    const saved=await store.completeIngredientReport(token,1,analysis.catalogVersion);
    await store.close();store=fixture.connect();
    assert.deepEqual((await store.getReport(token))?.analysis.skinProfile,profile);
    assert.equal((await store.getReport(token))?.id,saved.id);
  }finally{await fixture.cleanup();}
});
