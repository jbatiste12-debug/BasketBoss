import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {privateOutputDirectory,premiumImportSql,VERSIONED_PREMIUM_TABLE} from '../scripts/prepare-recipe-release.mjs';

test('private catalogue output rejects public paths and outside symlinks into the public root',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bb-private-release-'));
 try{
  const publicRoot=path.join(temp,'public');fs.mkdirSync(publicRoot);
  assert.throws(()=>privateOutputDirectory(path.join(publicRoot,'private'),publicRoot),/public checkout/);
  assert.equal(fs.existsSync(path.join(publicRoot,'private')),false);
  const alias=path.join(temp,'outside-alias');fs.symlinkSync(publicRoot,alias,'dir');
  assert.throws(()=>privateOutputDirectory(alias,publicRoot),/public checkout/);
  const safe=path.join(temp,'private-review');
  assert.equal(privateOutputDirectory(safe,publicRoot),fs.realpathSync(safe));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

const importRows=()=>Array.from({length:400},(_,i)=>({recipe_id:'premium-'+i,sort_index:i,
 recipe_json:JSON.stringify({id:'premium-'+i,name:i===0?"Chef's pie'); DROP TABLE bb_private_premium_recipes; --":'Dinner '+i,tip:'Natural café texture\nSecond line'}),
 normalized_json:JSON.stringify({id:'premium-'+i,ingredients:[{key:"chef's beans",quantity:400,unit:'g'}]})}));
function atomicFileImport(db,sql){
 // Emulate the transaction owned by Wrangler's D1 remote file-import API.
 db.exec('BEGIN');
 try{db.exec(sql);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}
test('the versioned SQL import round-trips exact JSON, is idempotent and never changes the legacy schema or data',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec("CREATE TABLE bb_private_premium_recipes (opaque_legacy_field TEXT); INSERT INTO bb_private_premium_recipes VALUES ('keep existing data');");
  const before=db.prepare('SELECT * FROM bb_private_premium_recipes').all(),rows=importRows(),sql=premiumImportSql(rows);
  atomicFileImport(db,sql);atomicFileImport(db,sql);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${VERSIONED_PREMIUM_TABLE}`).get().n,400);
  const stored=db.prepare(`SELECT * FROM ${VERSIONED_PREMIUM_TABLE} ORDER BY sort_index`).all();
  for(let i=0;i<rows.length;i++)assert.deepEqual({...stored[i]},rows[i]);
  assert.deepEqual(db.prepare('SELECT * FROM bb_private_premium_recipes').all(),before);
  assert.deepEqual(db.prepare('PRAGMA table_info(bb_private_premium_recipes)').all().map(x=>x.name),['opaque_legacy_field']);
 }finally{db.close();}
});
test('a failed whole-file import rolls back replacement of the versioned table and leaves legacy data intact',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec("CREATE TABLE bb_private_premium_recipes (saved TEXT); INSERT INTO bb_private_premium_recipes VALUES ('untouched');");
  const initial=importRows();atomicFileImport(db,premiumImportSql(initial));
  db.exec(`CREATE TRIGGER reject_last BEFORE INSERT ON ${VERSIONED_PREMIUM_TABLE} WHEN NEW.recipe_id='premium-399' BEGIN SELECT RAISE(ABORT,'simulated import failure'); END;`);
  const changed=importRows();changed[0].recipe_json=JSON.stringify({id:'premium-0',name:'Changed during failed import'});
  assert.throws(()=>atomicFileImport(db,premiumImportSql(changed)),/simulated import failure/);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${VERSIONED_PREMIUM_TABLE}`).get().n,400);
  assert.equal(db.prepare(`SELECT recipe_json FROM ${VERSIONED_PREMIUM_TABLE} WHERE recipe_id='premium-0'`).get().recipe_json,initial[0].recipe_json);
  assert.equal(db.prepare('SELECT saved FROM bb_private_premium_recipes').get().saved,'untouched');
 }finally{db.close();}
});
test('private SQL generation rejects incomplete, duplicate, misaligned and oversized rows before writing an import',()=>{
 assert.throws(()=>premiumImportSql(importRows().slice(0,399)),/exactly 400/);
 for(const edit of [rows=>{rows[399]=rows[0];},rows=>{rows[399].sort_index=400;},rows=>{rows[399].recipe_id='wrong';},rows=>{rows[399].normalized_json=JSON.stringify({id:'wrong'});}]){
  const rows=importRows();edit(rows);assert.throws(()=>premiumImportSql(rows));
 }
 const oversized=importRows();oversized[0].recipe_json=JSON.stringify({id:'premium-0',name:'x'.repeat(100000)});
 assert.throws(()=>premiumImportSql(oversized),/statement size/);
});
