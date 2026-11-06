import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {auditAppleProductIds,runApplePurchaseDiagnostic,APPLE_DIAGNOSTIC_PRODUCTS} from '../scripts/verify-apple-purchase-flow.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));

test('local Apple diagnostic audits exact runtime/fixture IDs and exercises catalogue unlock and negative outcomes',async()=>{
 const report=await runApplePurchaseDiagnostic({root:ROOT});
 assert.equal(report.passed,true,JSON.stringify(report.checks));
 assert.deepEqual(report.productAudit.products,{monthly:'uk.co.basketboss.premium.monthly',annual:'uk.co.basketboss.premium.annual'});
 assert.equal(report.productAudit.sources.length,5);assert.ok(report.productAudit.sources.every(source=>source.match));
 assert.equal(report.checks.length,7);assert.ok(report.checks.every(check=>check.passed));
 assert.equal(report.checks[0].purchased.recipes,500);assert.equal(report.checks[0].signedOut.recipes,100);
 assert.equal(report.releaseMockModeAdded,false);assert.equal(report.productionBillingTested,false);assert.equal(report.backendPremiumGranted,false);assert.equal(report.appStoreConnectProductMetadataVerified,false);
});

test('ID audit detects one-character drift rather than treating similar product names as matching',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'basketboss-iap-id-audit-'));
 const names=['native/apple-purchases.mjs','native/membership.mjs','ios/App/App/BasketBossPurchasesPlugin.swift','bb-server-lib/bb-apple-subscriptions.js','ios/App/App/BasketBossPremium.storekit'];
 try{
  for(const name of names){const target=path.join(dir,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(ROOT,name),target);}
  const target=path.join(dir,'ios/App/App/BasketBossPremium.storekit'),catalogue=JSON.parse(await fs.readFile(target,'utf8'));
  catalogue.subscriptionGroups[0].subscriptions.find(product=>product.productID===APPLE_DIAGNOSTIC_PRODUCTS.annual).productID+='x';await fs.writeFile(target,JSON.stringify(catalogue));
  const audit=await auditAppleProductIds(dir);assert.equal(audit.passed,false);assert.equal(audit.sources.find(source=>source.path.endsWith('.storekit')).match,false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
