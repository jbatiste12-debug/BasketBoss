import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {validateGeminiResult,geminiRequest,onRequest} from '../functions/api/bb173/[action].js';

const input=names=>({ingredients:names,mode:'only_have',servings:4});
const recipe=name=>({title:'A simple meal',summary:'Prepare the selected food.',servings:4,prepMinutes:5,cookMinutes:10,
 ingredients:[{name,quantity:'200 g',fromHome:true}],extraIngredients:[],steps:['Prepare the selected food according to its packaging.'],allergens:[],safetyNotes:['Check ingredient labels and safe cooking.']});

test('only-have meals retain food identity instead of claiming part of a compound ingredient',()=>{
 for(const [selected,generated] of [
  ['Chicken stock','Chicken'],['Chicken','Chicken stock'],['Chicken (stock)','Chicken'],
  ['Tomato paste','Tomato'],['Tomato (paste)','Tomatoes'],['Pasta sauce','Pasta'],
  ['Coconut milk','Milk'],['Coconut flour','Coconut'],['Cream cheese','Cream'],
  ['Garlic powder','Garlic'],['Peanut butter','Butter'],['Baby milk','Milk']
 ])assert.equal(validateGeminiResult('generate',recipe(generated),input([selected])),false,selected+' must not authorize '+generated);
});

test('exact foods keep common plural, case, accent and preparation variants',()=>{
 for(const [selected,generated] of [
  ['Onions','Onion'],['Tomatoes','Tomato'],['Potatoes','Potato'],['Berries','Berry'],
  ['Basil leaves','Basil leaf'],['Wholemeal loaves','Wholemeal loaf'],
  ['Red chillies','Red chilli'],['Cookies','Cookie'],['Brownies','Brownie'],['Pies','Pie'],
  ['Fresh chopped carrots','Carrot'],['Tomatoes (chopped)','Tomato'],
  ['Organic courgettes','Courgette'],['JALAPEÑOS','jalapeno'],
  ['Cooked chicken','Cooked chicken'],['Chicken stock','Chicken stock']
 ])assert.equal(validateGeminiResult('generate',recipe(generated),input([selected])),true,selected+' should authorize '+generated);
});

test('raw and cooked food descriptions are not silently exchanged',()=>{
 for(const [selected,generated] of [['Raw chicken','Cooked chicken'],['Cooked chicken','Chicken'],['Chicken','Cooked chicken']])
  assert.equal(validateGeminiResult('generate',recipe(generated),input([selected])),false);
});

test('plain water is the only unselected ingredient exemption',()=>{
 assert.equal(validateGeminiResult('generate',recipe('Water'),input(['Pasta'])),true);
 for(const name of ['Salt','Olive oil','Butter','Chicken stock','Water (chicken stock)'])
  assert.equal(validateGeminiResult('generate',recipe(name),input(['Pasta'])),false,name);
});

test('purchased ingredient names must match the declared shopping extras without compound substitutions',()=>{
 const result=recipe('Pasta');result.ingredients.push({name:'Cream',quantity:'100 ml',fromHome:false});result.extraIngredients=['Cream cheese'];
 const request={...input(['Pasta']),mode:'up_to_two'};
 assert.equal(validateGeminiResult('generate',result,request),false);
 result.extraIngredients=['Cream'];assert.equal(validateGeminiResult('generate',result,request),true);
 result.ingredients[1].name='Onion';result.extraIngredients=['Onions'];assert.equal(validateGeminiResult('generate',result,request),true);
});

test('only-have instructions prohibit unlisted foods throughout method and serving suggestions',()=>{
 const prompt=geminiRequest('generate',input(['Pasta','Tomatoes'])).parts[0].text;
 assert.match(prompt,/only the selected foods and plain water/);
 assert.match(prompt,/every method step, garnish, seasoning, sauce and side dish/);
 assert.match(prompt,/Do not assume oil, butter, salt, pepper, spices, stock or other staples unless selected/);
 assert.match(prompt,/Retain the selected ingredient names, food identity and raw or cooked state/);
 assert.match(prompt,/Chicken stock is not chicken meat; tomato paste is not tomatoes/);
 const extras=geminiRequest('generate',{...input(['Pasta']),mode:'up_to_two'}).parts[0].text;
 assert.match(extras,/every food used in the method/);assert.match(extras,/no more than 2 extra purchased ingredients/);
});

test('a generated false ingredient is rejected before the route can issue a meal-picture ticket',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE bb_ai_daily_usage(day_utc TEXT,actor TEXT,action TEXT,used INTEGER,PRIMARY KEY(day_utc,actor,action)); CREATE TABLE bb_account_deletions(actor_hash TEXT PRIMARY KEY);');
 const providerCalls=[],previous=globalThis.fetch;
 const env={BB_PREMIUM_AI_ENABLED:'true',BB_BILLING_ENABLED:'true',BB_BILLING_MODE:'live',BB_OWNER_USER_ID:'test-owner',
  SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',GEMINI_API_KEY:'synthetic-provider-secret',
  TURNSTILE_SITE_KEY:'synthetic-site',TURNSTILE_SECRET_KEY:'synthetic-turnstile',BB_AI_GLOBAL_DAILY_CAP:'20',
  BILLING_DB:{prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;}};}};}}};
 globalThis.fetch=async address=>{
  if(String(address).endsWith('/auth/v1/user'))return Response.json({id:'test-owner',email:'test@example.invalid',email_confirmed_at:'2026-11-01T00:00:00Z'});
  providerCalls.push(String(address));return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(recipe('Chicken'))}]}}]});
 };
 try{
  const request=new Request('https://basketboss.co.uk/api/bb173/generate',{method:'POST',headers:{Origin:'https://basketboss.co.uk','Content-Type':'application/json',Authorization:'Bearer synthetic'},body:JSON.stringify(input(['Chicken stock']))});
  const response=await onRequest({request,env,params:{action:'generate'}});
  assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'AI request could not be completed or validated.'});
  assert.equal(providerCalls.length,1);assert(!providerCalls[0].includes('flash-image'));
 }finally{globalThis.fetch=previous;db.close();}
});
