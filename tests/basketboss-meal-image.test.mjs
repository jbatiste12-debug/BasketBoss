import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {issueMealImageTicket,verifyMealImageTicket,MEAL_IMAGE_TICKET_MS,mealImageModel,mealImageGlobalCap,requestMealImage,validMealImage,boundedProviderJSON} from '../bb-server-lib/bb-meal-image.js';
import {onRequest} from '../functions/api/bb173/[action].js';
import {digestDeletionActor} from '../bb-server-lib/bb-account-deletion.js';

const origin='https://basketboss.co.uk',key='synthetic-gemini-secret',member={id:'verified_owner'},price='pri_'+'p'.repeat(26);
const recipe={title:'Chicken and broccoli pasta',summary:'A simple family meal.',servings:4,prepMinutes:10,cookMinutes:15,
 ingredients:[{name:'Cooked chicken',quantity:'200 g',fromHome:true},{name:'Pasta',quantity:'300 g',fromHome:true},{name:'Broccoli',quantity:'200 g',fromHome:true}],
 extraIngredients:[],steps:['Boil the pasta and broccoli.','Reheat cooked chicken thoroughly and combine.'],allergens:['Wheat'],safetyNotes:['Check safe storage and reheat the chicken thoroughly.']};
const input={ingredients:['Cooked chicken','Pasta','Broccoli'],mode:'only_have',servings:4};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3vUAAAAASUVORK5CYII=';
const imageResult=()=>Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:png}}]}}]});
const envBase={GEMINI_API_KEY:key,BB_AI_GLOBAL_DAILY_CAP:'10'};

test('image ticket binds the validated recipe, actor, household quota owner, origin and short lifetime',async()=>{
 const now=1700000000000;
 const ticket=await issueMealImageTicket(recipe,member,envBase,origin,now);
 assert.equal(ticket.expiresAt,now+MEAL_IMAGE_TICKET_MS);
 const grant=await verifyMealImageTicket(ticket.ticket,member,envBase,origin,now+1000);
 assert.deepEqual(grant.recipe,recipe);assert.ok(!ticket.ticket.includes(key));
 for(const [account,site,instant] of [[{id:'other'},origin,now],[{...member,bbQuotaOwnerId:'other'},origin,now],[member,'https://www.basketboss.co.uk',now],[member,origin,now+MEAL_IMAGE_TICKET_MS],[member,origin,now-60000]])
  assert.equal(await verifyMealImageTicket(ticket.ticket,account,envBase,site,instant),null);
 const parts=ticket.ticket.split('.');
 const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString());payload.recipe.ingredients[0].name='raw chicken';
 parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
 assert.equal(await verifyMealImageTicket(parts.join('.'),member,envBase,origin,now),null);
 assert.equal(await verifyMealImageTicket('v1.'+'a'.repeat(64000)+'.'+'0'.repeat(64),member,envBase,origin,now),null);
});

test('image request has a fixed provider/model, exact preparation details and no account identity',async()=>{
 const calls=[];
 const output=await requestMealImage(recipe,envBase,async(url,options)=>{calls.push({url,options});return imageResult();});
 assert.equal(output.dataBase64,png);assert.equal(output.alt,'AI illustration of '+recipe.title);
 const call=calls[0];assert.equal(call.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent');
 const body=JSON.parse(call.options.body);assert.deepEqual(body.generationConfig.responseModalities,['TEXT','IMAGE']);
 assert.ok(body.contents[0].parts[0].text.includes('Cooked chicken'));assert.ok(body.contents[0].parts[0].text.includes('Reheat cooked chicken'));
 assert.ok(!call.options.body.includes(member.id));assert.ok(!call.options.body.includes(key));
 assert.equal(mealImageModel({...envBase,BB_AI_IMAGE_MODEL:'https://attacker.invalid/model'}),null);
 assert.equal(mealImageGlobalCap({...envBase,BB_AI_IMAGE_GLOBAL_DAILY_CAP:'0'}),null);
});

test('picture validation rejects SVG, URLs, malformed base64, wrong raster magic and text-only provider output',async()=>{
 assert.equal(validMealImage('image/png',png),true);
 for(const [mime,data] of [['image/svg+xml',png],['image/png','https://example.invalid/photo'],['image/jpeg',png],['image/png',png+'!']])assert.equal(validMealImage(mime,data),false);
 for(const response of [new Response('synthetic-provider-private-text',{status:500}),Response.json({candidates:[{content:{parts:[{text:'synthetic-provider-private-text'}]}}]}),Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/svg+xml',data:png}}]}}]})])
  await assert.rejects(requestMealImage(recipe,envBase,async()=>response));
 let cancelled=false;
 const oversized=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8000001));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}});
 await assert.rejects(boundedProviderJSON(oversized));assert.equal(cancelled,true);
});

function routeHarness(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE bb_ai_daily_usage(day_utc TEXT,actor TEXT,action TEXT,used INTEGER NOT NULL,PRIMARY KEY(day_utc,actor,action));CREATE TABLE bb_account_deletions(actor_hash TEXT PRIMARY KEY);');
 const calls=[];let actor=member.id,authenticated=true,providerFailure=false;
 const env={...envBase,BB_BILLING_MODE:'live',BB_BILLING_ENABLED:'true',BB_PREMIUM_AI_ENABLED:'true',BB_OWNER_USER_ID:member.id,
  SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',TURNSTILE_SITE_KEY:'synthetic-site',TURNSTILE_SECRET_KEY:'synthetic-turnstile',PADDLE_LIVE_STANDARD_PRICE_ID:price,
  BILLING_DB:{prepare(sql){
   if(sql.includes('FROM bb_paid_entitlements'))return {bind(){return {async first(){return {status:'active',plan:'standard',price_id:price};}};}};
   const statement=db.prepare(sql);return {bind(...args){return {async first(){return statement.get(...args)||null;}};},async run(){return statement.run();}};
  }}
 };
 const previous=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  calls.push({url:String(url),options});
  if(String(url).endsWith('/auth/v1/user'))return authenticated?Response.json({id:actor,email:'not-sent-to-image@example.com',email_confirmed_at:'2026-11-01T00:00:00Z'}):Response.json({error:'invalid'},{status:401});
  if(String(url).includes('generativelanguage.googleapis.com')){
   if(providerFailure)return new Response('synthetic-provider-private-text',{status:500});
   return String(url).includes('flash-image')?imageResult():Response.json({candidates:[{content:{parts:[{text:JSON.stringify(recipe)}]}}]});
  }
  throw Error('Unexpected fixture request');
 };
 async function request(action,body,headers={}){
  const response=await onRequest({request:new Request(origin+'/api/bb173/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer synthetic-session',...headers},body:JSON.stringify(body)}),env,params:{action}});
  return {status:response.status,body:await response.json(),headers:response.headers};
 }
 return {db,env,calls,request,actor:value=>{actor=value;},authenticate:value=>{authenticated=value;},providerFailure:value=>{providerFailure=value;},close(){globalThis.fetch=previous;db.close();}};
}
async function withHarness(fn){const h=routeHarness();try{await fn(h);}finally{h.close();}}

test('a real validated meal returns before its picture is requested, and concurrent ticket replay spends once',async()=>withHarness(async h=>{
 const created=await h.request('generate',input);assert.equal(created.status,200);assert.deepEqual(created.body.recipe,recipe);assert.equal(created.body.reviewRequired,true);
 assert.equal(h.calls.filter(x=>x.url.includes('flash-image')).length,0);
 const responses=await Promise.all([h.request('meal-image',{ticket:created.body.mealImage.ticket}),h.request('meal-image',{ticket:created.body.mealImage.ticket})]);
 assert.deepEqual(responses.map(x=>x.status).sort(),[200,409]);
 assert.equal(h.calls.filter(x=>x.url.includes('flash-image')).length,1);
 const image=responses.find(x=>x.status===200);assert.equal(image.body.illustrative,true);assert.equal(image.body.mealImage.dataBase64,png);assert.match(image.headers.get('Cache-Control'),/no-store/);
 const rows=h.db.prepare('SELECT actor,action,used FROM bb_ai_daily_usage').all();
 assert.equal(rows.find(x=>x.actor==='user:'+member.id&&x.action==='meal-image').used,1);
 assert.equal(rows.filter(x=>x.action.startsWith('meal-image-ticket:')).length,1);
 assert.ok(!JSON.stringify(rows).includes(recipe.title));
}));

test('ten draft meals and ten pictures have separate bounded allowances; an eleventh picture is denied',async()=>withHarness(async h=>{
 for(let i=0;i<10;i++){
  const created=await h.request('generate',input);assert.equal(created.status,200);
  assert.equal((await h.request('meal-image',{ticket:created.body.mealImage.ticket})).status,200);
 }
 const extraTicket=await issueMealImageTicket(recipe,member,h.env,origin);
 assert.equal((await h.request('meal-image',{ticket:extraTicket.ticket})).status,429);
 assert.equal(h.calls.filter(x=>x.url.includes('flash-image')).length,10);
 assert.equal(h.db.prepare("SELECT used FROM bb_ai_daily_usage WHERE actor=? AND action='generate'").get('user:'+member.id).used,10);
 assert.equal(h.db.prepare("SELECT used FROM bb_ai_daily_usage WHERE actor='global' AND action='all'").get().used,10);
 assert.equal(h.db.prepare("SELECT used FROM bb_ai_daily_usage WHERE actor='global' AND action='meal-image-all'").get().used,10);
}));

test('unminted, foreign-account, foreign-origin and deleting-account image requests never reach the provider',async()=>withHarness(async h=>{
 const created=await h.request('generate',input),ticket=created.body.mealImage.ticket;
 assert.equal((await h.request('meal-image',{ticket:'a'.repeat(120)})).status,403);
 h.actor('other-paid-user');assert.equal((await h.request('meal-image',{ticket})).status,403);h.actor(member.id);
 assert.equal((await h.request('meal-image',{ticket},{Origin:'https://attacker.invalid'})).status,403);
 h.db.prepare('INSERT INTO bb_account_deletions(actor_hash) VALUES(?)').run(await digestDeletionActor(member.id));
 assert.equal((await h.request('meal-image',{ticket})).status,409);
 assert.equal(h.calls.filter(x=>x.url.includes('flash-image')).length,0);
}));

test('a provider error returns a fixed picture-only failure without exposing provider text or changing the recipe',async()=>withHarness(async h=>{
 const created=await h.request('generate',input);h.providerFailure(true);
 const image=await h.request('meal-image',{ticket:created.body.mealImage.ticket});assert.equal(image.status,502);
 assert.equal(image.body.error,'The meal picture could not be created. Your recipe is still ready to review.');assert.deepEqual(created.body.recipe,recipe);
 assert.ok(!JSON.stringify(image.body).includes('synthetic-provider-private-text'));
}));

test('an optional image-ticket signing failure never discards the validated recipe',async()=>withHarness(async h=>{
 h.env.GEMINI_API_KEY={toString(){throw Error('synthetic-signing-key-failure');}};
 const created=await h.request('generate',input);assert.equal(created.status,200);assert.deepEqual(created.body.recipe,recipe);assert.equal(created.body.mealImage,null);
}));
