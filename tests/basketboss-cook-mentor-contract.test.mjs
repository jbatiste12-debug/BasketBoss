import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readCookingQuestion} from '../bb-server-lib/bb-cook-assistant.js';
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
