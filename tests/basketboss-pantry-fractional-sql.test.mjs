import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const modulePath=process.env.BB_RECEIPT_PGLITE_PATH;
test('actual PostgreSQL preserves fractional pantry balances but rejects fractional receipt counts', {skip:!modulePath}, async()=>{
 const {PGlite}=await import(pathToFileURL(modulePath).href),db=new PGlite();
 const actor='11111111-1111-4111-8111-111111111111',scope={kind:'user',id:actor};
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
   CREATE TABLE auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   CREATE TABLE public.bb_households(id uuid primary key,owner_user_id uuid,partner_user_id uuid,partner_email text,invite_status text);
   INSERT INTO auth.users VALUES('${actor}','cook@example.test',now());`);
  for(const file of ['../sql/basketboss_receipt_inventory_20261031.sql','../supabase/migrations/20261104174441_receipt_auto_stock_policy.sql','../supabase/migrations/20261104174450_pantry_fractional_stock_balances.sql'])await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
  const rpc=async(action,body={})=>(await db.query('SELECT public.bb_receipt_inventory_service($1,$2,$3,$4,$5,$6,$7,$8::jsonb) AS result',[actor,'user',actor,action,body.requestId||null,body.receiptId||null,body.receiptId?'a'.repeat(64):null,JSON.stringify(body)])).rows[0].result;
  const stock={'egg|each':1.5,'rice|pack':1/3,'milk|ml':1e-9,'oil|tbsp':.5};
  const saved=await rpc('confirm_pantry',{action:'confirm_pantry',expectedScope:scope,expectedRevision:0,stock,shopSessionId:'shop'});
  assert.equal(saved.ok,true,JSON.stringify(saved));assert.deepEqual(saved.stock,stock);assert.deepEqual((await rpc('get')).stock,stock);
  const valid=async(name,value)=>(await db.query(`SELECT public.bb_receipt_inventory_valid_${name}($1::jsonb) AS valid`,[JSON.stringify(value)])).rows[0].valid;
  assert.equal(await valid('stock',stock),true);assert.equal(await valid('purchase',{'egg|each':1.5}),false);assert.equal(await valid('purchase',{'rice|pack':.5}),false);
  assert.equal(await valid('purchase',{'rice|g':12.5}),true);assert.equal(await valid('purchase',{'egg|each':2}),true);
  for(const bad of [{'rice|pack':-1},{'rice|handful':1},{'rice|g':1000001},{'soap|each':1},{'rice|g':'1'}])assert.equal(await valid('stock',bad),false);
  const body={action:'confirm_receipt',addToPantry:true,expectedScope:scope,requestId:'request-fractional',receiptId:'receipt-fractional',shopSessionId:'shop',market:'UK',currency:'GBP',retailer:'Tesco',purchasedAt:'2026-11-04T12:00:00Z',receiptTotal:1,adjustments:[],inventoryBaseline:{stock,expectedRevision:1,initialize:false},priceObservations:[],lines:[{lineId:'eggs',kind:'food',canonicalKey:'egg',name:'Eggs',brand:'',quantity:1.5,unit:'each',packCount:1,packQuantity:1.5,packUnit:'each',pricePaid:1,priceType:'regular',location:'cupboard'}]};
  const rejected=await rpc('confirm_receipt',body);assert.equal(rejected.ok,false,JSON.stringify(rejected));assert.equal(rejected.invalid,true);assert.deepEqual((await rpc('get')).stock,stock);
  body.lines[0].quantity=2;body.lines[0].packQuantity=2;const accepted=await rpc('confirm_receipt',body);assert.equal(accepted.ok,true,JSON.stringify(accepted));assert.deepEqual(accepted.stock,{...stock,'egg|each':3.5});
  const grants=(await db.query("SELECT has_function_privilege('anon','public.bb_receipt_inventory_valid_purchase(jsonb)','EXECUTE') AS anon,has_function_privilege('authenticated','public.bb_receipt_inventory_service(uuid,text,uuid,text,text,text,text,jsonb)','EXECUTE') AS authenticated,has_function_privilege('service_role','public.bb_receipt_inventory_valid_purchase(jsonb)','EXECUTE') AS service")).rows[0];assert.deepEqual(grants,{anon:false,authenticated:false,service:true});
  const flags=(await db.query("SELECT relrowsecurity FROM pg_class WHERE relname IN ('bb_receipt_inventory_scopes','bb_receipt_inventory_receipts','bb_receipt_inventory_requests','bb_receipt_inventory_legacy_claims')")).rows;assert.equal(flags.length,4);assert.ok(flags.every(x=>x.relrowsecurity));
 }finally{await db.close();}
});
