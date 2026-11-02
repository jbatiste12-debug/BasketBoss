import test from 'node:test';
import assert from 'node:assert/strict';
import {cookRequiredFlags,cookReportFailure} from '../scripts/ios-cook-report.mjs';
const complete=()=>({complete:true,passed:true,legacyVisible:false,...Object.fromEntries(cookRequiredFlags.map(key=>[key,true]))});
test('Cook accepts only the complete passing real-app report',()=>{
 assert.equal(cookReportFailure(complete()),'');
 for(const report of [null,{}, {...complete(),complete:false}])assert.equal(cookReportFailure(report),'report_timeout');
 for(const report of [{...complete(),passed:false},{...complete(),passed:1},{...complete(),legacyVisible:true}])assert.equal(cookReportFailure(report),'ui_failed');
});
test('every navigation, ingredients, voice and data-retention check is independently mandatory',()=>{
 for(const key of cookRequiredFlags){
  const report=complete();delete report[key];assert.equal(cookReportFailure(report),'ui_failed',key+' missing');
  report[key]=false;assert.equal(cookReportFailure(report),'ui_failed',key+' false');
 }
});
