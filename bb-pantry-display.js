/* Formatting only. Display units never become stored quantities. */
(function(root,factory){const api=factory(root?.BBPantryPolicy||(typeof module==='object'?require('./bb-pantry-policy.js'):null));if(typeof module==='object')module.exports=api;if(root)root.BBPantryDisplay=api;})(typeof window==='undefined'?null:window,function(policy){
 'use strict';
 const number=(n,market)=>new Intl.NumberFormat(market==='US'?'en-US':'en-GB',{maximumFractionDigits:2}).format(n);
 function format(name,quantity,unit,market='UK',options={}){
  const q=Number(quantity);if(quantity===null||quantity===''||!Number.isFinite(q)||q<0)return 'Review amount ('+String(quantity??'unknown')+' '+String(unit||'')+')';
  if(options.staple){const label=policy.containerLabel(name);return number(q,market)+' '+label+(q===1?'':'s')+(options.status?' · '+({in:'In Stock',low:'Low',out:'Out'}[options.status]||'Review status'):'');}
  if(['each','count','clove'].includes(unit))return number(q,market)+' '+(/garlic/i.test(name)?'clove'+(q===1?'':'s'):'unit'+(q===1?'':'s'));
  if(!['g','kg','ml','l'].includes(unit))return 'Review amount ('+number(q,market)+' '+unit+')';
  const amount=q*(['kg','l'].includes(unit)?1000:1),weight=['g','kg'].includes(unit);
  if(market!=='US')return number(amount,market)+' '+(weight?'g':'ml');
  if(weight){const cup=options.preferredUnit==='cup'?policy.cupGrams(name):null;if(cup)return '≈ '+number(amount/cup.grams,market)+' US cups';return number(amount/(amount>=453.6?453.6:28.35),market)+(amount>=453.6?' lb':' oz');}
  if(options.preferredUnit==='pint')return number(amount/473,market)+' US pints';
  if(options.preferredUnit==='fl oz'||amount<60)return number(amount/30,market)+' fl oz';
  return number(amount/240,market)+' US cups';
 }
 return Object.freeze({format});
});
