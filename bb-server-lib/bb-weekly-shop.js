/* One new Free advanced shop per UTC week. Only hashed account/session usage
 * metadata is stored; normal shopping lists and billing remain independent. */
import {digestDeletionActor,ensureDeletionSchema,isAccountDeleting} from './bb-account-deletion.js';

export const WEEKLY_SHOP_TABLE_SQL=`CREATE TABLE IF NOT EXISTS bb_weekly_shop_trips (
 actor_hash TEXT NOT NULL,
 week_start TEXT NOT NULL,
 session_id TEXT NOT NULL,
 started_at_ms INTEGER NOT NULL,
 PRIMARY KEY(actor_hash,week_start)
)`;
export const WEEKLY_SHOP_INDEX_SQL='CREATE UNIQUE INDEX IF NOT EXISTS bb_weekly_shop_sessions ON bb_weekly_shop_trips(actor_hash,session_id)';
const prepared=new WeakSet();
const canonical=value=>String(value).replace(/\bIF NOT EXISTS\s+/g,'').replace(/\s+/g,' ').replace(/\s*([(),])\s*/g,'$1').replace(/;$/,'').trim();
export class WeeklyShopError extends Error{
 constructor(code,status=503){super(code);this.code=code;this.status=status;}
}
export function weeklyShopPeriod(now=Date.now()){
 const date=new Date(now);date.setUTCHours(0,0,0,0);date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
 const weekStart=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()+7);
 return {weekStart,nextResetAt:date.toISOString()};
}
export async function ensureWeeklyShopSchema(env){
 const db=env.BILLING_DB;if(!db?.prepare||!db?.batch)throw new WeeklyShopError('weekly_shop_unavailable');
 if(prepared.has(db))return;
 await db.batch([db.prepare(WEEKLY_SHOP_TABLE_SQL),db.prepare(WEEKLY_SHOP_INDEX_SQL)]);
 for(const [type,name,definition]of[['table','bb_weekly_shop_trips',WEEKLY_SHOP_TABLE_SQL],['index','bb_weekly_shop_sessions',WEEKLY_SHOP_INDEX_SQL]]){
  const row=await db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').bind(type,name).first();
  if(!row||canonical(row.sql)!==canonical(definition))throw new WeeklyShopError('weekly_shop_schema_unavailable');
 }
 prepared.add(db);
}
async function account(env,userId){
 await ensureDeletionSchema(env);
 if(await isAccountDeleting(env,userId))throw new WeeklyShopError('account_deletion_pending',409);
 return digestDeletionActor(userId);
}
export async function readWeeklyShop(env,userId,now=Date.now()){
 const actor=await account(env,userId);await ensureWeeklyShopSchema(env);
 const period=weeklyShopPeriod(now);
 const row=await env.BILLING_DB.prepare('SELECT session_id FROM bb_weekly_shop_trips WHERE actor_hash=? AND week_start=?').bind(actor,period.weekStart).first();
 return {...period,used:!!row,sessionId:row?.session_id||null};
}
export async function startWeeklyShop(env,userId,sessionId,now=Date.now()){
 const actor=await account(env,userId);await ensureWeeklyShopSchema(env);
 const db=env.BILLING_DB,period=weeklyShopPeriod(now);
 const existing=()=>db.prepare('SELECT session_id,week_start FROM bb_weekly_shop_trips WHERE actor_hash=? AND session_id=?').bind(actor,sessionId).first();
 let approved=await existing(),created=false;
 if(!approved){
  // Per-week PK and per-account session UNIQUE make simultaneous starts and
  // retries across a Sunday/Monday boundary atomic and idempotent. The durable
  // deletion tombstone also fences an in-flight start after account erasure.
  const result=await db.prepare(`INSERT OR IGNORE INTO bb_weekly_shop_trips(actor_hash,week_start,session_id,started_at_ms)
   SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM bb_account_deletions WHERE actor_hash=?)`)
   .bind(actor,period.weekStart,sessionId,now,actor).run();
  created=Number(result?.meta?.changes||0)>0;approved=await existing();
 }
 if(await isAccountDeleting(env,userId))throw new WeeklyShopError('account_deletion_pending',409);
 if(!approved)throw new WeeklyShopError('weekly_shop_limit',429);
 // Keep the tiny approval record until account deletion: another signed-in
 // device may still be resuming an older unfinished trip. No list contents,
 // location, prices, account email or bearer credentials are retained here.
 const current=await db.prepare('SELECT session_id FROM bb_weekly_shop_trips WHERE actor_hash=? AND week_start=?').bind(actor,period.weekStart).first();
 return {...period,allowed:true,used:!!current,sessionId:approved.session_id,sessionWeekStart:approved.week_start,resumed:!created};
}
