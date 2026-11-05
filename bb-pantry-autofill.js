/* Pantry-aware proposal scoring. Reservations affect this proposal only;
   planning never consumes the user's saved stock or invents expiry dates. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBPantryAutofill=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const UNITS=new Set(['g','ml','each','clove','bulb','tin','pack','bag','bunch','loaf','slice']);
 const RESERVED=new Set(['__proto__','constructor','prototype']);
 const WEIGHTS=Object.freeze({pantryMatch:3,useSoonMatch:40,recent7Days:6,recent14Days:3,sameProtein:4});
 const DAY=86400000;
 const LIMIT=1000000,round=value=>Math.round(value*1000000)/1000000;
 const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=LIMIT;
 const nonnegative=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=LIMIT;
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.prototype.toString.call(value)==='[object Object]';
 const copy=value=>JSON.parse(JSON.stringify(value));
 const physicalKey=value=>typeof value==='string'&&value.length<=220&&value.split('|').length===2&&!!value.split('|')[0].trim()&&!RESERVED.has(text(value.split('|')[0]))&&/^[a-z][a-z0-9 _-]{0,39}$/i.test(value.split('|')[1]);
 const text=value=>typeof value==='string'?value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' '):'';
 function isStaple(name,{wholeFood=false}={}){
  const key=text(name);
  if(key==='pepper'&&wholeFood)return false;
  if(typeof window!=='undefined'&&window.BBPantryPolicy?.isStaple(key))return true;
  return key==='salt and pepper'||/^(?:(?:fine|coarse|flaky|sea|table|kosher|rock|pink|himalayan|smoked|celery|garlic|onion) )*salt$/.test(key)||
   /^(?:(?:ground|cracked|freshly ground|freshly cracked) )?(?:(?:black|white|pink) )?(?:pepper|peppercorns)$/.test(key)||
   /^(?:(?:cooking|olive|extra virgin olive|vegetable|sunflower|rapeseed|canola|sesame|groundnut|peanut|coconut|corn|avocado|grapeseed|chilli|garlic|truffle) )?oil$/.test(key)||
   /^(?:(?:tap|cold|warm|hot|boiling|filtered|ice) )?water$/.test(key);
 }
 function timestamp(value){
  if(typeof value==='number')return Number.isFinite(value)&&value>=0&&value<=8640000000000000?value:null;
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d(?:T[^\r\n]{1,60})?$/.test(value))return null;
  const parsed=Date.parse(value);if(!Number.isFinite(parsed))return null;
  if(value.length===10&&new Date(parsed).toISOString().slice(0,10)!==value)return null;
  return parsed;
 }
 // lastPlannedAt is an actual per-recipe timestamp map, never undated seen IDs.
 // now can be an epoch-millisecond value or an injected clock function.
 function create({stock={},canonicalMeasure,lastPlannedAt={},now=Date.now,proposal,priorityStockKeys=[]}={}){
  const physical=typeof proposal==='function';
  if(!physical&&typeof canonicalMeasure!=='function')throw Error('Canonical pantry measurements are required.');
  let capturedNow;try{capturedNow=timestamp(typeof now==='function'?now():now);}catch{capturedNow=null;}
  const ledger=new Map(),invalid=new Set(),prioritySources=new Set((priorityStockKeys instanceof Set?[...priorityStockKeys]:Array.isArray(priorityStockKeys)?priorityStockKeys:[]).filter(physicalKey)),priorityCanonical=new Set();
  const proposedStock=new WeakMap();let physicalStock={};
  function measure(name,quantity,unit,sourceIngredients){
   if(typeof name!=='string'||!name.trim()||name.includes('|')||RESERVED.has(name.trim().toLowerCase())||!positive(quantity)||typeof unit!=='string'||!unit.trim())return null;
   let value;try{value=canonicalMeasure(name,quantity,unit,{sourceIngredients});}catch{return null;}
   if(!value||typeof value.key!=='string'||!value.key.trim()||value.key.includes('|')||RESERVED.has(value.key)||!UNITS.has(value.unit)||!positive(value.quantity)||value.needsReview&&!value.estimated)return null;
   if(value.estimated&&(typeof value.assumption!=='string'||!value.assumption.trim()))return null;
   const amount=round(value.quantity);if(!positive(amount))return null;
   return {id:value.key+'|'+value.unit,key:value.key,unit:value.unit,quantity:amount,estimated:value.estimated===true,assumption:value.estimated?value.assumption:null,
    wholeFood:value.sourceUnit==='each'&&value.estimated===true&&/per whole item/.test(value.assumption||'')};
  }
  let entries=[];
  try{if(stock&&typeof stock==='object'&&!Array.isArray(stock))entries=Object.entries(stock);}catch{}
  for(const [id,quantity]of entries.slice(0,2000)){
   if(physical){if(physicalKey(id)&&nonnegative(quantity))physicalStock[id]=quantity;continue;}
   if(typeof id!=='string'||id.length>220||id.split('|').length!==2)continue;
   const [name,unit]=id.split('|'),value=measure(name,quantity,unit);
   if(!value||invalid.has(value.id))continue;
   const previous=ledger.get(value.id),total=round((previous?.quantity||0)+value.quantity);
   if(!positive(total)){ledger.delete(value.id);invalid.add(value.id);continue;}
   ledger.set(value.id,{...value,quantity:total,estimated:!!previous?.estimated||value.estimated,wholeFood:!!previous?.wholeFood||value.wholeFood,
    assumptions:new Set([...(previous?.assumptions||[]),...(value.assumption?[value.assumption]:[])])});
   if(prioritySources.has(id))priorityCanonical.add(value.id);
  }
  function finishAssessment(details,{recipeId='',protein='',previousProtein='',lastPlannedAt:history=lastPlannedAt}={}){
   let plannedAt=null;
   try{plannedAt=timestamp(typeof history?.get==='function'?history.get(recipeId):history&&!Array.isArray(history)&&Object.hasOwn(history,recipeId)?history[recipeId]:null);}catch{}
   const ageDays=capturedNow!==null&&plannedAt!==null&&plannedAt<=capturedNow?(capturedNow-plannedAt)/DAY:null;
   const recentPenalty=ageDays!==null&&ageDays<=7?WEIGHTS.recent7Days:ageDays!==null&&ageDays<=14?WEIGHTS.recent14Days:0;
   const currentProtein=text(protein),yesterdayProtein=text(previousProtein);
   const sameProteinPenalty=currentProtein&&currentProtein!=='unknown'&&currentProtein===yesterdayProtein?WEIGHTS.sameProtein:0;
   const pantryBonus=details.pantryMatches*WEIGHTS.pantryMatch,useSoonMatches=new Set(details.used.filter(row=>row.priority&&!row.staple&&row.quantity>0).map(row=>row.key)).size,useSoonBonus=useSoonMatches*WEIGHTS.useSoonMatch;
   return {...details,score:pantryBonus+useSoonBonus-recentPenalty-sameProteinPenalty,pantryBonus,useSoonMatches,useSoonBonus,recentPenalty,sameProteinPenalty,ageDays};
  }
  function wholePepper(row,sourceIngredients){
   if(row.canonicalKey!=='pepper')return false;
   const display=text(row.name),namedWhole=/\b(?:bell|red|green|yellow|orange|sweet|mixed) peppers?\b/;
   if(namedWhole.test(display))return true;
   if(['each','piece','pieces','whole','pepper','peppers'].includes(text(row.unit)))return true;
   if((row.allocations||[]).some(part=>['each','piece','pieces','whole','pepper','peppers'].includes(text(part.sourceUnit))))return true;
   if((row.assumptions||[]).some(value=>/\bwhole\b|\bper (?:whole )?(?:item|pepper)\b/i.test(value)))return true;
   return (Array.isArray(sourceIngredients)?sourceIngredients:[]).some(value=>{
    const name=text(Array.isArray(value)?value[0]:value?.name||value?.key),amount=String(Array.isArray(value)?value[1]:value?.quantity||'');
    return name==='peppers'||name===display&&namedWhole.test(name)||name==='pepper'&&/\b(?:whole|each|peppers?)\b/i.test(amount);
   });
  }
  function assessPhysical(ingredients,options){
   const empty=()=>finishAssessment({coverage:0,matchedIngredients:0,requiredIngredients:Array.isArray(ingredients)?Math.min(500,ingredients.length):0,
    unmeasuredIngredients:Array.isArray(ingredients)?Math.min(500,ingredients.length):0,pantryMatches:0,pantryCoverage:0,stockUsedFraction:0,estimated:false,assumptions:[],used:[]},options);
   try{
    if(!Array.isArray(ingredients)||ingredients.length>500)return empty();
    const rows=copy(ingredients);for(const row of rows)if(object(row)&&!Object.hasOwn(row,'required')&&Object.hasOwn(row,'quantity'))row.required=row.quantity;
    const before={...physicalStock},result=proposal({stock:{...before},ingredients:rows});
    if(result&&typeof result.then==='function'){result.catch?.(()=>{});return empty();}
    if(!object(result)||!Array.isArray(result.rows)||result.rows.length>500||!object(result.remainingStock))return empty();
    const remaining={},allocated=new Map(),rowIds=new Set(),used=[],assumptions=new Set(),matched=new Set();
    for(const [id,quantity]of Object.entries(result.remainingStock)){
     if(!physicalKey(id)||!Object.hasOwn(before,id)||!nonnegative(quantity)||quantity>before[id])return empty();
     remaining[id]=quantity;
    }
    let coverageSum=0,pantryCoverageSum=0,stockUsedFraction=0,requiredIngredients=0,unmeasuredIngredients=0,nonStapleRequirements=0,estimated=false,totalAllocations=0;
    for(const row of result.rows){
     if(!object(row)||typeof row.id!=='string'||!row.id||row.id.length>220||rowIds.has(row.id)||row.required!==null&&!nonnegative(row.required)||!nonnegative(row.owned)||!nonnegative(row.deduct))return empty();
     rowIds.add(row.id);
     if(row.required===null&&row.deduct>0||row.required!==null&&row.deduct>row.required||row.deduct>row.owned)return empty();
     const parts=row.allocations===undefined?[]:row.allocations;
     if(!Array.isArray(parts)||(totalAllocations+=parts.length)>10000)return empty();
     let usedQuantity=0;
     for(const part of parts){
      if(!object(part)||!Object.hasOwn(before,part.stockKey)||!positive(part.sourceQuantity)||!positive(part.quantity)||part.sourceQuantity>before[part.stockKey])return empty();
      if(typeof part.sourceUnit!=='string'||!part.sourceUnit.trim()||part.sourceUnit.length>40)return empty();
      allocated.set(part.stockKey,round((allocated.get(part.stockKey)||0)+part.sourceQuantity));usedQuantity+=part.quantity;
     }
     if(Math.abs(usedQuantity-row.deduct)>.000001)return empty();
     if(row.required===0)continue;
     requiredIngredients++;
     const key=typeof row.canonicalKey==='string'?row.canonicalKey:row.id.slice(0,row.id.lastIndexOf('|'));
     if(!key||key.includes('|')||RESERVED.has(text(key)))return empty();
     const staple=isStaple(key,{wholeFood:wholePepper({...row,canonicalKey:key},options?.sourceIngredients)});
     if(!staple)nonStapleRequirements++;
     if(row.required===null||typeof row.unit!=='string'||!row.unit.trim()){unmeasuredIngredients++;if(row.deduct>0)return empty();continue;}
     if(row.deduct===0)continue;
     if(row.id!==key+'|'+row.unit||row.unit.length>40)return empty();
     if(row.estimated!==undefined&&typeof row.estimated!=='boolean')return empty();
     const notes=row.assumptions===undefined?[]:row.assumptions;
     if(!Array.isArray(notes)||notes.length>200||notes.some(value=>typeof value!=='string'||!value.trim()||value.length>300)||row.estimated===true&&!notes.length)return empty();
     coverageSum+=row.deduct/row.required;stockUsedFraction+=row.deduct/row.owned;
     if(!staple){matched.add(key);pantryCoverageSum+=row.deduct/row.required;}
     estimated||=row.estimated===true;for(const note of notes)assumptions.add(note);
     used.push({id:row.id,key,unit:row.unit,quantity:row.deduct,required:row.required,available:row.owned,estimated:row.estimated===true,staple,...(parts.some(part=>prioritySources.has(part.stockKey))?{priority:true}:{})});
    }
    let changed=false;
    for(const [id,quantity]of Object.entries(before)){
     if(quantity>(remaining[id]||0))changed=true;
     if(Math.abs(quantity-(remaining[id]||0)-(allocated.get(id)||0))>.000001)return empty();
    }
    if(used.length&&!changed)return empty();
    const assessed=finishAssessment({coverage:requiredIngredients?coverageSum/requiredIngredients:0,matchedIngredients:used.length,requiredIngredients,unmeasuredIngredients,
     pantryMatches:matched.size,pantryCoverage:nonStapleRequirements?pantryCoverageSum/nonStapleRequirements:0,stockUsedFraction,estimated,assumptions:[...assumptions].sort(),used},options);
    proposedStock.set(assessed,remaining);return assessed;
   }catch{return empty();}
  }
  // Callers supply already eligible, serving-scaled ingredient rows. Protein
  // identifiers are compared exactly after case/space normalization; no species
  // or broader protein group is inferred here.
  function assess(ingredients=[],options={}){
   if(physical)return assessPhysical(ingredients,options);
   const {sourceIngredients}=options;
   const requirements=new Map(),invalidRequirements=new Set();let unmeasuredIngredients=0,unmeasuredNonStaples=0;
   for(const row of (Array.isArray(ingredients)?ingredients:[]).slice(0,200)){
    if(!row||typeof row!=='object'||Array.isArray(row))continue;
    const quantity=Object.hasOwn(row,'required')?row.required:row.quantity;
    if(quantity===0)continue;
    const value=measure(row.key||row.name,quantity,row.unit,row.sourceIngredients||sourceIngredients);
    if(!value){unmeasuredIngredients++;if(!isStaple(row.key||row.name))unmeasuredNonStaples++;continue;}
    if(invalidRequirements.has(value.id))continue;
    const previous=requirements.get(value.id),total=round((previous?.quantity||0)+value.quantity);
    if(!positive(total)){requirements.delete(value.id);invalidRequirements.add(value.id);unmeasuredIngredients++;if(!isStaple(value.key,value))unmeasuredNonStaples++;continue;}
    requirements.set(value.id,{...value,quantity:total,estimated:!!previous?.estimated||value.estimated,wholeFood:!!previous?.wholeFood||value.wholeFood,
     assumptions:new Set([...(previous?.assumptions||[]),...(value.assumption?[value.assumption]:[])])});
   }
   const used=[],assumptions=new Set(),matchedPantryKeys=new Set();let coverageSum=0,stockUsedFraction=0,estimated=false,pantryCoverageSum=0,nonStapleRequirements=unmeasuredNonStaples;
   for(const [id,required]of requirements){
    const available=ledger.get(id),staple=isStaple(required.key,{wholeFood:required.wholeFood||available?.wholeFood});
    if(!staple)nonStapleRequirements++;
    if(!available)continue;
    const quantity=round(Math.min(required.quantity,available.quantity));if(!positive(quantity))continue;
    coverageSum+=quantity/required.quantity;stockUsedFraction+=quantity/available.quantity;
    if(!staple){matchedPantryKeys.add(required.key);pantryCoverageSum+=quantity/required.quantity;}
    const approximation=required.estimated||available.estimated;estimated||=approximation;
    for(const assumption of [...required.assumptions,...available.assumptions])assumptions.add(assumption);
    used.push({id,key:required.key,unit:required.unit,quantity,required:required.quantity,available:available.quantity,estimated:approximation,staple,...(priorityCanonical.has(id)?{priority:true}:{})});
   }
   const requiredIngredients=requirements.size+unmeasuredIngredients,coverage=requiredIngredients?coverageSum/requiredIngredients:0;
   // Coverage remains a tie-breaker, never an age claim or a hard eligibility rule.
   return finishAssessment({coverage,matchedIngredients:used.length,requiredIngredients,unmeasuredIngredients,
    pantryMatches:matchedPantryKeys.size,pantryCoverage:nonStapleRequirements?pantryCoverageSum/nonStapleRequirements:0,
    stockUsedFraction,estimated,assumptions:[...assumptions].sort(),used},options);
  }
  function reserve(ingredients,options){
   const result=assess(ingredients,options);
   if(physical){const next=proposedStock.get(result);if(next)physicalStock={...next};return result;}
   for(const row of result.used){
    const entry=ledger.get(row.id),remaining=round(Math.max(0,entry.quantity-row.quantity));
    if(remaining>0)ledger.set(row.id,{...entry,quantity:remaining});else ledger.delete(row.id);
   }
   return result;
  }
  const snapshot=()=>physical?{...physicalStock}:Object.fromEntries([...ledger].map(([id,value])=>[id,value.quantity]));
  function rank(candidates=[],{ingredients=value=>value?.ingredients||[],sourceIngredients,context={}}={}){
   return (Array.isArray(candidates)?candidates:[]).map((candidate,index)=>{
    let rows=[],raw,scoring={};
    try{rows=ingredients(candidate);raw=typeof sourceIngredients==='function'?sourceIngredients(candidate):sourceIngredients;const provided=typeof context==='function'?context(candidate):context;scoring=provided&&typeof provided==='object'&&!Array.isArray(provided)?provided:{};}catch{}
    return {candidate,index,...assess(rows,{...scoring,recipeId:scoring.recipeId||candidate?.id||'',sourceIngredients:raw})};
   }).sort((a,b)=>b.score-a.score||b.pantryCoverage-a.pantryCoverage||a.index-b.index);
  }
  return Object.freeze({assess,reserve,snapshot,rank});
 }
 return Object.freeze({create,isStaple,weights:WEIGHTS});
});
