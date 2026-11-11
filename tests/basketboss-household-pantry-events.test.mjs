import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const original=fs.readFileSync(new URL('../bb-household-sharing.js',import.meta.url),'utf8');
// Expose reads/actions from the shipped closure only inside this test VM.
const source=original.replace('function boot(){','window.__householdEvents={open,refreshStatus};function boot(){');
assert.notEqual(source,original);
const ACTOR='11111111-1111-4111-8111-111111111111',HOUSEHOLD='22222222-2222-4222-8222-222222222222';

function fixture({action='invite',fail=false,allowConfirm=true}={}){
 const values=new Map([['basketboss_cloud_session_v1',JSON.stringify({user:{id:ACTOR},access_token:'synthetic-household-token'})],['basketboss_321_v7_measured_pantry','{"rice|g":233.333333}']]);
 const calls=[],events=[],win=new EventTarget();let committed=0,confirmed=0;
 let current={configured:true,premium:true,household_id:HOUSEHOLD,role:'owner',invite_status:'accepted',partner_email:'partner@example.invalid'};
 if(action==='accept')current={...current,role:'free',household_id:null,invite:{household_id:HOUSEHOLD}};
 const node=()=>({value:'',textContent:'',addEventListener(){},replaceChildren(){}});
 const body={nodes:new Map(),textContent:'',set innerHTML(html){this.html=html;this.nodes=new Map();for(const name of ['accept','email','invite','unlink','sync','init-import'])if(html.includes('data-'+name))this.nodes.set('[data-'+name+']',node());},querySelector(selector){return this.nodes.get(selector)||null;}};
 const message=node(),review=node(),close=node();
 const dialog={open:false,innerHTML:'',setAttribute(){},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},querySelector:selector=>selector==='[data-bbhs-body]'?body:selector==='[data-bbhs-message]'?message:selector==='[data-bbhs-review]'?review:selector==='.bbhs-close'?close:null};
 const document={readyState:'loading',hidden:false,body:{append(){}},createElement:()=>dialog,addEventListener(){}};
 const storage={getItem:key=>values.get(key)??null,setItem(){throw Error('Link notifications must not move pantry data');},removeItem(){throw Error('Link notifications must not remove pantry data');}};
 win.addEventListener('basketboss:household-changed',event=>events.push({committed,action:event.detail?.action}));
 const sandbox={window:win,document,localStorage:storage,navigator:{onLine:true},Event,JSON,Date,console,location:{reload(){throw Error('No unrelated local merge is expected');}},confirm(){confirmed++;return allowConfirm;},fetch:async(url,options={})=>{
  const request=options.body?JSON.parse(options.body):null;calls.push({url,request});
  if(!request)return Response.json(current);
  if(fail)return Response.json({error:'Synthetic rejected household action'},{status:409});
  committed++;
  if(request.action==='accept')current={configured:true,premium:true,household_id:HOUSEHOLD,role:'partner',invite_status:'accepted'};
  if(request.action==='invite')current={...current,household_id:HOUSEHOLD,invite_status:'pending'};
  if(request.action==='unlink')current={...current,invite_status:'none',partner_email:null};
  return Response.json({ok:true,household_id:HOUSEHOLD,message:'Saved'});
 }};
 vm.runInNewContext(source,sandbox);
 return {win,values,calls,events,body,api:win.__householdEvents,get confirmed(){return confirmed;},async click(){await this.api.open();const button=body.querySelector('[data-'+action+']');assert.ok(button,'the existing action button is reused');if(action==='invite')body.querySelector('[data-email]').value='partner@example.invalid';await button.onclick();}};
}

for(const action of ['invite','accept','unlink'])test(`successful household ${action} emits one pantry refresh notification after the server commits`,async()=>{
 const h=fixture({action}),before=new Map(h.values);await h.click();
 assert.equal(h.calls.filter(call=>call.request?.action===action).length,1);
 assert.deepEqual(h.events,[{committed:1,action}]);assert.deepEqual(h.values,before,'link notification never adopts or merges inventory');
 await h.api.refreshStatus();await h.api.refreshStatus();assert.equal(h.events.length,1,'status polling does not create notification loops');
});

for(const action of ['invite','accept','unlink'])test(`a rejected household ${action} does not announce a new pantry scope`,async()=>{
 const h=fixture({action,fail:true}),before=new Map(h.values);await h.click();assert.equal(h.events.length,0);assert.deepEqual(h.values,before);
});

test('cancelling unlink preserves the existing confirmation handler and emits no pantry event',async()=>{
 const h=fixture({action:'unlink',allowConfirm:false});await h.click();assert.equal(h.confirmed,1);assert.equal(h.calls.some(call=>call.request),false);assert.equal(h.events.length,0);
});
