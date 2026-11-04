import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readCookingQuestion} from '../bb-server-lib/bb-cook-assistant.js';
import {cookingAnswerStreamResponse} from '../bb-server-lib/bb-cook-stream.js';
const {create}=createRequire(import.meta.url)('../bb-cook-assistant.js');

test('real mentor transport sends a named, serving-scaled recipe that the server accepts',async()=>{
 for(const region of ['UK','US','GG','JE']){
  const recipe={id:'fajitas',title:'Chicken fajitas',servings:4,ingredients:[{name:'Chicken',quantity:region==='US'?'≈ 1.47 lb (665 g)':'665 g'}],steps:[region==='US'?'Heat the oven to 392°F (200°C).':'Heat the oven to 200°C.'],currentStep:0,phase:'cook',region};
  const session={user:{id:'contract-test-actor'},access_token:'synthetic-not-a-credential',expires_at:Date.now()/1000+3600};
  let received;
  const win={navigator:{onLine:true},BasketBossSession:{read:()=>session},fetch:async(url,options)=>{
   assert.equal(url,'/api/cook-assistant');
   const parsed=await readCookingQuestion(new Request('https://basketboss.co.uk/api/cook-assistant',options));
   assert.equal(parsed.error,undefined,'client and server must agree on all named mentor fields');received=parsed.value;
   return Response.json({answer:'I’m Chef Boss. Let’s start with the oven.'});
  }};
  const result=await create({window:win}).ask({question:'What should I do first?',recipe,mentorName:'Chef Boss',history:[{role:'user',text:'Can you help me cook this?'},{role:'assistant',text:'Of course. What would you like to know?'}]});
  assert.match(result.answer,/Chef Boss/);assert.equal(received.mentorName,'Chef Boss');
  assert.deepEqual(received.recipe,recipe);assert.equal(received.history.length,2);
 }
});

test('real server SSE and client NDJSON pipeline delivers a first sentence before provider completion',async()=>{
 const recipe={id:'salmon',title:'Salmon with peas',servings:4,ingredients:[{name:'Salmon',quantity:'665 g'}],steps:['Cook until safely done.'],currentStep:0,phase:'cook',region:'UK'};
 const session={user:{id:'contract-stream-actor'},access_token:'synthetic-not-a-credential',expires_at:Date.now()/1000+3600};
 let source,settings,seenResolve;const seen=new Promise(resolve=>seenResolve=resolve),tokens=[],encoder=new TextEncoder();
 const upstream=new Response(new ReadableStream({start(controller){source=controller;}}),{headers:{'Content-Type':'text/event-stream'}});
 const win={navigator:{onLine:true},BasketBossSession:{read:()=>session},fetch:async(url,options)=>{
  settings=options;const parsed=await readCookingQuestion(new Request('https://basketboss.co.uk'+url,options));assert.equal(parsed.error,undefined);
  return cookingAnswerStreamResponse(parsed.value,{OPENAI_API_KEY:'synthetic-provider-key'},{signal:options.signal,perform:async()=>upstream});
 }};
 const item={id:'message-contract',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Keep the heat gentle. Stir occasionally.'}]};
 const indices={item_id:item.id,output_index:0,content_index:0};
 const emit=(type,value={})=>source.enqueue(encoder.encode('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n'));
 const result=create({window:win}).ask({question:'How should I cook it?',recipe,history:[]},{onDelta:text=>{tokens.push(text);seenResolve();}});
 emit('response.created',{response:{status:'in_progress'}});emit('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});emit('response.content_part.added',{...indices,part:{type:'output_text',text:''}});emit('response.output_text.delta',{...indices,delta:'Keep the heat gentle.'});
 await seen;assert.deepEqual(tokens,['Keep the heat gentle.']);assert.equal(settings.headers.Accept,'application/x-ndjson');
 emit('response.output_text.delta',{...indices,delta:' Stir occasionally.'});emit('response.output_text.done',{...indices,text:item.content[0].text});emit('response.content_part.done',{...indices,part:item.content[0]});emit('response.output_item.done',{output_index:0,item});emit('response.completed',{response:{status:'completed',output:[item]}});
 assert.deepEqual(await result,{answer:item.content[0].text});assert.equal(tokens.join(''),item.content[0].text);
});
