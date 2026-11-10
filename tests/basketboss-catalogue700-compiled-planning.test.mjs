import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {compileCatalogueDinner,isCatalogueDinner} from '../tools/catalogue700/planning.mjs';
import {transform700Planning} from '../tools/catalogue700/build-client.mjs';
const roles=JSON.parse(fs.readFileSync('catalogues/700/release/planning-roles.json','utf8'));
const original=fs.readFileSync('bb-recipe-planning.js','utf8'),context={window:{}};
vm.runInNewContext(original,context);const legacy=context.window.BBRecipePlanning.isDinner;
const options=r=>({catalogueVersion:700,roles:r,legacyIsDinner:legacy});
const recipe=r=>({id:r.id,catalogueNumber:r.catalogueNumber,name:r.kind==='breakfast'?'Breakfast oats':'Savoury supper',category:r.kind==='dinner'?'Family Meals':r.kind,tag:'',dinnerEligible:r.kind==='dinner'});

test('compiled roles preserve dynamic dinner decisions for every authored role and per-recipe edit',()=>{
 const compiled=compileCatalogueDinner(options(roles));
 for(const role of roles.recipes)for(const edit of [{},{dinnerEligible:false},{catalogueNumber:500},{category:'Breakfast & Brunch'},{name:'Chocolate brownies'},{id:'unregistered-meal'},{mealType:'dessert'}]){
  const r={...recipe(role),...edit};assert.equal(compiled(r),isCatalogueDinner(r,options(roles)),role.id+JSON.stringify(edit));
 }
 for(const r of [null,{},...roles.legacyRecipeIds.map(id=>({id,name:'Family dinner',category:'Family Meals'}))])assert.equal(compiled(r),isCatalogueDinner(r,options(roles)));
});

test('invalid headers fail closed; invalid new rows retain the exact original legacy path',()=>{
 const dinner={id:roles.legacyRecipeIds[0],name:'Family dinner',category:'Family Meals'};
 for(const changed of [{...roles,schemaVersion:2},{...roles,legacyRecipeIds:roles.legacyRecipeIds.slice(1)},{...roles,legacyRecipeIds:roles.legacyRecipeIds.map(()=>roles.legacyRecipeIds[0])},{...roles,recipes:null},{...roles,recipes:[...roles.recipes,roles.recipes[0]]},{...roles,recipes:[{id:'invalid',catalogueNumber:800,kind:'dinner'}]}]){
  const compiled=compileCatalogueDinner(options(changed));
  for(const r of [dinner,...roles.recipes.slice(0,3).map(recipe)])assert.equal(compiled(r),isCatalogueDinner(r,options(changed)));
 }
});

test('compiled metadata is a private snapshot while every recipe eligibility check remains live',()=>{
 const changed=structuredClone(roles),role=changed.recipes.find(r=>r.kind==='dinner'&&r.id!=='southern-chicken-and-waffles');
 const r=recipe(role),compiled=compileCatalogueDinner(options(changed));assert.equal(compiled(r),true);
 role.kind='breakfast';changed.recipes.length=0;changed.legacyRecipeIds.length=0;
 assert.equal(compiled(r),true,'external authored-object mutation cannot alter the compiled session');
 r.category='Breakfast & Brunch';assert.equal(compiled(r),false,'recipe fields are checked on every call');
 r.category='Family Meals';r.dinnerEligible=false;assert.equal(compiled(r),false);
});

test('generated module reads authored role metadata once instead of rescanning it for each candidate',()=>{
 let reads=0;
 const source=transform700Planning(original,roles).replace('const catalogue700Roles=', 'const catalogue700RolesSource=').replace('  const catalogue700Dinner=', '  const catalogue700Roles=new Proxy(catalogue700RolesSource,{get(target,key){globalThis.roleReads++;return target[key];}});\n  const catalogue700Dinner=');
 const c={window:{},roleReads:0};vm.runInNewContext(source,c);
 reads=c.roleReads;assert.ok(reads>0);
 for(let round=0;round<10;round++)for(const role of roles.recipes)c.window.BBRecipePlanning.isDinner(recipe(role));
 assert.equal(c.roleReads,reads,'candidate loops must not revalidate the whole role manifest');
});
