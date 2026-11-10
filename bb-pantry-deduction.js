/* A pure Cook stock proposal. Legacy callers retain strict metric matching;
 * an explicit conversion context can allocate reviewed physical stock units. */
(function(root,factory){'use strict';const common=typeof module==='object'&&module.exports;const api=factory(root?.BBPantryPolicy||(common?require('./bb-pantry-policy.js'):null));if(common)module.exports=api;if(root)root.BBPantryDeduction=api;})(typeof window==='undefined'?null:window,function(/** @type {typeof import('./bb-pantry-policy')|null} */ policy){
 'use strict';
 /** @typedef {import('./types/pantry-workflow').StockMap} StockMap */
 /** @typedef {import('./types/pantry-workflow').CanonicalId} CanonicalId */
 /** @typedef {import('./types/pantry-workflow').DeductionInput} DeductionInput */
 /** @typedef {import('./types/pantry-workflow').DeductionRow} DeductionRow */
 /** @typedef {import('./types/pantry-workflow').PantryConversionContext} PantryConversionContext */
 /** @typedef {{factor:number,estimated:boolean,assumptions:string[]}} ConversionPath */
 /** @typedef {ConversionPath & {to:string}} ConversionEdge */
 /** @typedef {ConversionPath & {unit:string,invalid?:false}} PackageMeasure */
 /** @typedef {{invalid:true}} InvalidPackage */
 /** @typedef {{stockKey:string,food:string,canonicalKey:string,state:string,sourceUnit:string,info:import('./types/pantry-workflow').MeasureInfo,pack:PackageMeasure|InvalidPackage|null,excluded:boolean}} ConversionSource */
 /** @typedef {DeductionRow & {canonicalKey:string|null,estimated:boolean,assumptions:string[],allocations:import('./types/pantry-workflow').StockAllocation[],_conversion:{food:string|null,state:string,measurable:boolean,invalid:boolean,stateConflict?:boolean,smallStaple?:boolean,reviewEdit?:boolean}}} ConversionRow */
 const MAX=1000000;
 /** @type {Record<string,string>} */
 const aliases={gram:'g',grams:'g',kilogram:'kg',kilograms:'kg',millilitre:'ml',millilitres:'ml',milliliter:'ml',milliliters:'ml',litre:'l',litres:'l',liter:'l',liters:'l',cloves:'clove',bulbs:'bulb',tins:'tin',can:'tin',cans:'tin',packs:'pack',bags:'bag',bunches:'bunch',loaves:'loaf',slices:'slice',items:'each',item:'each',pieces:'each',piece:'each',whole:'each',teaspoon:'tsp',teaspoons:'tsp',tablespoon:'tbsp',tablespoons:'tbsp',cups:'cup',ounce:'oz',ounces:'oz',pound:'lb',pounds:'lb',lbs:'lb','fluid ounce':'fl oz','fluid ounces':'fl oz',floz:'fl oz',pints:'pint'};
 const known=new Set(['g','ml','each','clove','bulb','tin','pack','bag','bunch','loaf','slice','tsp','tbsp','cup']);
 /** @param {unknown} value @returns {value is Record<string,unknown>} */
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 /** @param {number} value */
 const round=value=>Math.round(value*1000000)/1000000;
 /** @param {unknown} value @returns {value is number} */
 const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=MAX;
 /** @param {unknown} value */
 const unit=value=>{const raw=String(value||'').trim().toLowerCase();return aliases[raw]||raw;};
 /** @param {unknown} value @returns {import('./types/pantry-workflow').MeasureInfo} */
 function measure(value){const parsed=unit(value),base=parsed==='kg'?'g':parsed==='l'?'ml':parsed;return {unit:base,factor:parsed==='kg'||parsed==='l'?1000:1,known:known.has(base)};}
 /** @param {unknown} value @returns {string|null} */
 const name=value=>typeof value==='string'&&value.trim()&&value.length<=180&&!value.includes('|')&&!['__proto__','constructor','prototype'].includes(value)?value.trim():null;
 /** @type {CanonicalId} */
 const defaultId=(food,units)=>food.toLowerCase().trim()+'|'+units;
 /** @param {string} food @param {string} units @param {CanonicalId} id */
 function canonicalId(food,units,id){const value=id(food,units);if(typeof value!=='string'||value.length>220||!value.includes('|')||['__proto__','constructor','prototype'].includes(value))throw Error('Check the pantry ingredient names.');return value;}
 /** @param {StockMap} stock @param {CanonicalId} [id] @returns {import('./types/pantry-workflow').StockData} */
 function stockData(stock,id=defaultId){
  if(!object(stock))throw Error('Review your saved pantry amounts before cooking.');
  const values=/** @type {StockMap} */ ({}),names=new Map();
  for(const [raw,quantity]of Object.entries(stock)){
   const at=raw.lastIndexOf('|'),food=name(raw.slice(0,at));
   if(at<1||!food||!valid(quantity))throw Error('Review your saved pantry amounts before cooking.');
   const info=measure(raw.slice(at+1));
   if(!info.unit||info.unit.length>40)throw Error('Review your saved pantry units before cooking.');
   const key=canonicalId(food,info.unit,id),amount=quantity*info.factor;
   if(!valid(amount)||!valid((values[key]||0)+amount))throw Error('Check the pantry amounts before cooking.');
   values[key]=round((values[key]||0)+amount);names.set(key,canonicalId(food,'',id).split('|')[0]);
  }
  return {values,names};
 }
 /** @param {unknown} value @returns {value is number} */
 const positive=value=>valid(value)&&value>0;
 /** @param {string[]} values */
 const unique=values=>[...new Set(values.filter(value=>typeof value==='string'&&value.trim()))];
 /** @param {unknown} value */
 function foodState(value){
  const text=String(value||'').toLowerCase().replace(/[-–—]/g,' '),states=[];
  if(/\b(?:cooked|precooked|ready cooked)\b/.test(text)&&!/\buncooked\b/.test(text))states.push('cooked');
  if(/\bfrozen\b/.test(text))states.push('frozen');if(/\b(?:canned|tinned)\b/.test(text))states.push('canned');if(/\b(?:dry|dried)\b/.test(text))states.push('dried');
  return states.join('|');
 }
 /** @param {DeductionInput & {id:CanonicalId,conversion:PantryConversionContext}} input @returns {import('./types/pantry-workflow').DeductionResult} */
 function convertedProposal({stock,ingredients,amounts,id,conversion}){
  if(!object(conversion)||!object(stock)||!Array.isArray(ingredients)||ingredients.length>500)throw Error('Review the pantry conversion details before cooking.');
  if(conversion.excludedStockKeys!==undefined&&(!Array.isArray(conversion.excludedStockKeys)||conversion.excludedStockKeys.length>2000||conversion.excludedStockKeys.some(key=>typeof key!=='string'||!key||key.length>240)))throw Error('Review excluded pantry sources before cooking.');
  for(const entries of [conversion.measuredStockKeys,conversion.measuredFoods])if(entries!==undefined&&(!Array.isArray(entries)||entries.length>2000||entries.some(key=>typeof key!=='string'||!key||key.length>240)))throw Error('Review measured pantry sources before cooking.');
  const excludedStockKeys=new Set(conversion.excludedStockKeys||[]);
  const physical=/** @type {StockMap} */ ({...stock}),sources=/** @type {ConversionSource[]} */ ([]),rows=/** @type {ConversionRow[]} */ ([]),byId=/** @type {Map<string,ConversionRow>} */ (new Map()),ruleCache=/** @type {Map<string,Map<string,ConversionEdge[]>>} */ (new Map());
  const mode=conversion.pantryMode===true&&!!policy;
  // Only immutable food-name identities are shared within this one proposal.
  // Stock, quantities, conversion rules and allocations remain fresh below.
  const foodNames=/** @type {Map<string,string>} */ (new Map());
  /** @param {string} value */
  const foodName=value=>{
   if(!mode)return value;
   if(!foodNames.has(value))foodNames.set(value,policy.canonicalName(value));
   return /** @type {string} */ (foodNames.get(value));
  };
  /** @param {string} value */
  const stateFor=value=>foodState(foodName(value));
  /** @param {string} value */
  const foodId=value=>{const result=canonicalId(foodName(value),'',id).split('|')[0];if(!result||['__proto__','constructor','prototype'].includes(result.toLowerCase()))throw Error('Check the pantry ingredient names.');return result;};
  // The validation loop above checks the values at runtime. Keep the narrowed
  // string-array types explicit after the shared object guard.
  const measuredKeyNames=/** @type {string[]} */ (Array.isArray(conversion.measuredStockKeys)?conversion.measuredStockKeys:[]),measuredFoodNames=/** @type {string[]} */ (Array.isArray(conversion.measuredFoods)?conversion.measuredFoods:[]);
  const measuredStockKeys=new Set(measuredKeyNames),measuredFoods=new Set(measuredFoodNames.map(food=>foodId(food)+'|state:'+stateFor(food)));
  for(const key of measuredStockKeys)if(Object.hasOwn(stock,key)){const food=key.slice(0,key.lastIndexOf('|'));if(name(food))measuredFoods.add(foodId(food)+'|state:'+stateFor(food));}
  const stockMetadata=/** @type {Record<string,import('./types/pantry-workflow').ReviewedStockConversion>} */ (object(conversion.stock)?conversion.stock:{}),foodMetadata=/** @type {Record<string,import('./types/pantry-workflow').FoodConversion>} */ (object(conversion.foods)?conversion.foods:{});
  if(Object.keys(stock).length>2000||Object.keys(foodMetadata).length>2000)throw Error('Review the saved pantry amounts before cooking.');
  /** @param {string} food @returns {Map<string,ConversionEdge[]>} */
  function rules(food){
   const key=foodId(food)+'|state:'+stateFor(food);if(ruleCache.has(key))return /** @type {Map<string,ConversionEdge[]>} */ (ruleCache.get(key));
   const edges=/** @type {Map<string,ConversionEdge[]>} */ (new Map());
   /** @param {string} from @param {string} to @param {number} factor @param {boolean} estimated @param {string[]} assumptions */
   const add=(from,to,factor,estimated,assumptions)=>{
    if(from===to||!Number.isFinite(factor)||factor<=0)return;
    /** @param {string} a @param {string} b @param {number} ratio */
    const connect=(a,b,ratio)=>{if(!Number.isFinite(ratio)||ratio<=0)return;const list=edges.get(a)||[];if(!list.some(edge=>edge.to===b)){list.push({to:b,factor:ratio,estimated,assumptions});edges.set(a,list);}};
    connect(from,to,factor);connect(to,from,1/factor);
   };
   const matching=Object.entries(foodMetadata).filter(([label,entry])=>name(label)&&object(entry)&&foodId(label)===foodId(food)&&stateFor(label)===stateFor(food));
   // Conflicting aliases cannot silently choose one density or item weight.
   const facts=matching.length&&matching.every(([,entry])=>entry.densityGPerMl===matching[0][1].densityGPerMl&&entry.gramsPerEach===matching[0][1].gramsPerEach)?matching[0][1]:null;
   if(facts&&(!facts.canonicalKey||name(facts.canonicalKey)&&foodId(facts.canonicalKey)===foodId(food)&&stateFor(facts.canonicalKey)===stateFor(food))){
    const factRows=/** @type {Array<['densityGPerMl'|'gramsPerEach',string,string,string]>} */ ([['densityGPerMl','ml','g','g per ml'],['gramsPerEach','each','g','g per item']]);
    for(const [property,from,to,label]of factRows){
     const value=facts[property];if(!positive(value))continue;const estimated=facts.estimated!==false;
     add(from,to,value,estimated,[facts.assumption||((estimated?'Estimated':'Supplied')+' '+value+' '+label+' for '+food)]);
    }
   }
   if(typeof conversion.canonicalMeasure==='function')for(const from of ['each','tsp','tbsp','cup']){
    if(from==='each'?conversion.basis?.wholeProduce!==true:conversion.basis?.spoons!==true)continue;
    let result;try{result=conversion.canonicalMeasure(food,1,from,{market:typeof conversion.market==='string'?conversion.market:undefined});}catch{continue;}
    if(!result)continue;const info=measure(result.unit);if(!positive(result.quantity)||!['g','ml','each'].includes(info.unit)||info.unit===from||result.key&&(!name(result.key)||foodId(result.key)!==foodId(food)||foodState(result.key)!==foodState(food)))continue;
    const factor=result.quantity*info.factor;if(!positive(factor))continue;
    add(from,info.unit,factor,from==='each'||result.estimated===true||result.needsReview===true,[result.assumption||('Recipe measure: 1 '+from+' = '+factor+' '+info.unit+' for '+food)]);
   }
   ruleCache.set(key,edges);return edges;
  }
  /** @param {string} food @param {string} from @param {string} to @returns {ConversionPath|null} */
  function bridge(food,from,to){
   if(from===to)return {factor:1,estimated:false,assumptions:[]};
   const graph=rules(food),queue=/** @type {Array<ConversionPath & {unit:string}>} */ ([{unit:from,factor:1,estimated:false,assumptions:[]}]),seen=new Set([from]);
   for(let index=0;index<queue.length;index++)for(const edge of graph.get(queue[index].unit)||[]){
    if(seen.has(edge.to))continue;const path={unit:edge.to,factor:queue[index].factor*edge.factor,estimated:queue[index].estimated||edge.estimated,assumptions:unique([...queue[index].assumptions,...edge.assumptions])};
    if(!Number.isFinite(path.factor)||path.factor<=0)continue;if(edge.to===to)return path;seen.add(edge.to);queue.push(path);
   }
   return null;
  }
  /** @param {string} food @param {unknown} rawUnit @param {unknown} metadata @param {string} [stockKey] @returns {PackageMeasure|InvalidPackage|null} */
  function packageMeasure(food,rawUnit,metadata,stockKey){
   const source=measure(rawUnit);if(['g','ml'].includes(source.unit)){
    if(mode){const normalized=policy.normalize(food,1,String(rawUnit||''),{market:typeof conversion.market==='string'?conversion.market:undefined});if(normalized&&normalized.unit!==source.unit)return {unit:normalized.unit,factor:normalized.quantity,estimated:normalized.estimated,assumptions:[normalized.assumption]};}
    return null;
   }
   if(!object(metadata)||metadata.reviewed!==true){
    if(!mode)return null;
    const normalized=policy.normalize(food,1,String(rawUnit||''),{market:typeof conversion.market==='string'?conversion.market:undefined});
    if(!normalized||normalized.unit===source.unit||!positive(normalized.quantity))return null;
    return {unit:normalized.unit,factor:normalized.quantity,estimated:normalized.estimated,assumptions:[normalized.assumption]};
   }
   let info=measure(metadata.packUnit),quantity=metadata.packQuantity,capacityEstimated=false,capacityAssumption='';
   const canonical=name(metadata.canonicalKey);
   if(mode){
    const normalized=policy.normalize(food,quantity,metadata.packUnit,{market:typeof conversion.market==='string'?conversion.market:undefined});
    if(normalized){info=measure(normalized.unit);quantity=normalized.quantity;capacityEstimated=normalized.estimated;capacityAssumption=normalized.assumption;}
   }
   if(metadata.stockKey!==undefined&&metadata.stockKey!==stockKey||metadata.sourceUnit!==undefined&&unit(metadata.sourceUnit)!==unit(rawUnit)||metadata.canonicalKey!==undefined&&(!canonical||foodId(canonical)!==foodId(food)||stateFor(canonical)!==stateFor(food))||!positive(quantity)||!info.known||info.unit===source.unit||!positive(quantity*info.factor))return {invalid:true};
   const assumption=typeof metadata.assumption==='string'?metadata.assumption:'';
   return {unit:info.unit,factor:quantity*info.factor,estimated:metadata.estimated===true||capacityEstimated,assumptions:unique([assumption||((metadata.estimated?'Estimated':'Reviewed')+' contents: 1 '+unit(rawUnit)+' = '+metadata.packQuantity+' '+metadata.packUnit+' for '+food),capacityAssumption])};
  }
  for(const [stockKey,quantity]of Object.entries(stock)){
   const at=stockKey.lastIndexOf('|'),food=name(stockKey.slice(0,at)),sourceUnit=stockKey.slice(at+1),info=measure(sourceUnit);
   if(at<1||!food||!sourceUnit||sourceUnit.length>40||!valid(quantity)||!valid(quantity*info.factor))throw Error('Review your saved pantry amounts and units before cooking.');
   sources.push({stockKey,food,canonicalKey:foodId(food),state:stateFor(food),sourceUnit,info,pack:packageMeasure(food,sourceUnit,stockMetadata[stockKey],stockKey),excluded:excludedStockKeys.has(stockKey)||mode&&policy.isStaple(food)&&measuredFoods.has(foodId(food)+'|state:'+stateFor(food))&&!measuredStockKeys.has(stockKey)});
  }
  for(const [index,ingredient]of ingredients.entries()){
   const food=name(ingredient?.key||ingredient?.name),display=name(ingredient?.name)||food||'Ingredient '+(index+1),info=measure(ingredient?.unit);
   const conversionFood=food&&stateFor(display)&&stateFor(display)!==stateFor(food)?display:food,state=mode?stateFor(conversionFood||display):foodState((food||'')+' '+display);
   if(ingredient?.required!==null&&ingredient?.required!==undefined&&!valid(ingredient.required))throw Error('Check the cooked serving amounts.');
   let required=valid(ingredient?.required)?ingredient.required*info.factor:null,recipeUnit=info.unit,assumptions=/** @type {string[]} */ ([]),estimated=false,invalid=false;
   const smallStaple=mode&&!!food&&policy.isStaple(food)&&required!==null&&policy.smallUse(food,required,recipeUnit);
   if(required!==null&&!valid(required))throw Error('Check the cooked serving amounts.');
   const metadata=ingredient?.reviewed===true||ingredient?.packReviewed===true||ingredient?.measurementReviewed===true?{...ingredient,reviewed:true}:null;
   const pack=conversionFood?packageMeasure(conversionFood,ingredient?.unit,metadata):null;
   if(pack?.invalid)invalid=true;
   else if(pack&&required!==null){required*=pack.factor;recipeUnit=pack.unit;estimated=pack.estimated;assumptions=pack.assumptions;}
   else if(mode&&conversionFood&&required!==null&&policy.normalize(conversionFood,required,recipeUnit,{market:typeof conversion.market==='string'?conversion.market:undefined})){
    const normalized=/** @type {NonNullable<ReturnType<typeof policy.normalize>>} */ (policy.normalize(conversionFood,required,recipeUnit,{market:typeof conversion.market==='string'?conversion.market:undefined}));
    required=normalized.quantity;recipeUnit=normalized.unit;estimated=normalized.estimated;if(normalized.assumption)assumptions=[normalized.assumption];
   }
   else if(conversionFood&&required!==null&&['each','tsp','tbsp','cup'].includes(recipeUnit)){
    const graph=rules(conversionFood),preferred=(graph.get(recipeUnit)||[]).find(edge=>['g','ml'].includes(edge.to));
    if(preferred){required*=preferred.factor;recipeUnit=preferred.to;estimated=preferred.estimated;assumptions=preferred.assumptions;}
   }
   if(required!==null&&(!valid(required)||positive(ingredient.required)&&required===0))throw Error('Check the converted recipe amounts before cooking.');
   const measurable=!!food&&!!recipeUnit&&known.has(recipeUnit)&&required!==null&&!invalid;
   const rowId=measurable?canonicalId(foodName(food),recipeUnit,id):'unmeasured-'+index,existing=measurable?byId.get(rowId):null;
   if(existing){existing.required=/** @type {number} */ (existing.required)+/** @type {number} */ (required);if(!valid(existing.required))throw Error('Check the combined cooked serving amounts.');if(existing._conversion.state!==state){existing._conversion.measurable=false;existing._conversion.stateConflict=true;}existing._conversion.smallStaple&&=smallStaple&&policy.smallUse(food,existing.required,recipeUnit);existing.estimated||=estimated;existing.assumptions=unique([...existing.assumptions,...assumptions]);continue;}
   const row=/** @type {ConversionRow} */ ({id:rowId,canonicalKey:food?foodId(food):null,name:display,unit:recipeUnit||null,required,owned:0,deduct:0,remaining:0,canDeduct:false,issue:null,issueLabel:'',estimated,assumptions:unique(assumptions),allocations:[],_conversion:{food:conversionFood,state,measurable,invalid,smallStaple}});
   rows.push(row);byId.set(rowId,row);Object.defineProperty(row,'_conversion',{enumerable:false});
  }
  const edits=/** @type {Map<string,number>} */ (new Map());
  if(amounts!==undefined){
   if(!Array.isArray(amounts)||amounts.length>rows.length)throw Error('Review the used ingredient amounts.');
   for(const edit of amounts){
    if(!object(edit)||!byId.has(edit.id)||edits.has(edit.id)||!valid(edit.quantity))throw Error('Review the used ingredient amounts.');
    const row=/** @type {ConversionRow} */ (byId.get(edit.id)),info=measure(edit.unit);
    if(mode&&row._conversion.food){
     const normalized=policy.normalize(row._conversion.food,edit.quantity,edit.unit,{market:typeof conversion.market==='string'?conversion.market:undefined});
     if(normalized?.unit===row.unit&&valid(normalized.quantity)){edits.set(edit.id,normalized.quantity);continue;}
    }
    if(edit.quantity!==0&&(!info.known||info.unit!==row.unit||!valid(edit.quantity*info.factor))){
     if(mode){row._conversion.reviewEdit=true;edits.set(edit.id,0);continue;}
     throw Error('Choose a compatible unit for '+row.name+'.');
    }
    edits.set(edit.id,edit.quantity*info.factor);
   }
  }
  for(const row of rows){
   const context=row._conversion,wanted=edits.has(row.id)?/** @type {number} */ (edits.get(row.id)):row.required;
   // The main ingredient catalogue singularises whole peppers to "pepper".
   // A counted recipe pepper stays produce unless the user explicitly tracks
   // that same identity as a condiment container/status item.
   const pepperIdentity=mode&&context.food&&policy.canonicalName(context.food)==='pepper';
   const explicitPepperStaple=pepperIdentity&&Object.keys(conversion.staples||{}).some(food=>name(food)&&foodId(food)===row.canonicalKey&&stateFor(food)===context.state);
   // Keep the source description: canonical "pepper" can mean counted/weighted
   // whole peppers or a seasoning jar. An aggregate legacy staple map cannot
   // override an unambiguous produce description such as "Peppers".
   const wholePepper=pepperIdentity&&(policy.isWholePepper?
    policy.isWholePepper(row.name,row.unit,{staple:explicitPepperStaple&&/^pepper$/i.test(row.name.trim())?true:undefined}):row.unit==='each'&&!explicitPepperStaple);
   // The catalogue may map culinary pepper and whole peppers to the same key.
   // Reviewed grams do not resolve that food-identity collision by themselves.
   const pepperLabels=measuredFoodNames.filter(food=>foodId(food)===row.canonicalKey&&/\bpepper(?:corns?|s)?\b/i.test(food)),pepperRoles=new Set(pepperLabels.map(food=>/^pepper$/i.test(food.trim())?'ambiguous':policy?.isWholePepper(food,'g',{})?'whole':'seasoning'));
   const recipePepper=/\bpepper(?:corns?|s)?\b/i.test(row.name),recipePepperRole=/^pepper$/i.test(row.name.trim())?'ambiguous':policy?.isWholePepper(row.name,row.unit,{})?'whole':'seasoning';
   if(mode&&recipePepper&&pepperRoles.size&&(recipePepperRole==='ambiguous'||pepperRoles.has('ambiguous')||pepperRoles.size>1||!pepperRoles.has(recipePepperRole))){row.issue='unit_mismatch';row.issueLabel='Whole peppers and pepper seasoning need separate ingredient identities. Review this food in At home; its saved stock stays unchanged.';continue;}
   if(mode&&context.food&&policy.isStaple(context.food)&&!wholePepper&&!measuredFoods.has(row.canonicalKey+'|state:'+context.state)){
    row.staple=true;
    const records=Object.entries(conversion.staples||{}).filter(([food])=>name(food)&&foodId(food)===row.canonicalKey&&stateFor(food)===context.state).map(([,entry])=>entry);
    const statuses=records.map(entry=>{const raw=typeof entry==='string'?entry:entry?.status||entry?.stapleStatus;return raw==='in_stock'?'in':raw==='in'||raw==='low'||raw==='out'?raw:'unknown';});
    const matching=sources.filter(source=>!source.excluded&&source.canonicalKey===row.canonicalKey&&source.state===context.state);
    const status=statuses.length?statuses.every(value=>value===statuses[0])?statuses[0]:'unknown':matching.some(source=>physical[source.stockKey]>0)?'in':'out';
    row.stapleStatus=status;row.stapleRestock=status==='low'||status==='out';row.covered=context.smallStaple===true&&status==='in';
    const count=records.filter(entry=>typeof entry==='object'&&entry!==null).map(entry=>entry.count).filter(valid);
    if(count.length===1)row.stapleCount=count[0];
    row.stockLabel=status==='in'?'In stock · container tracking':status==='low'?'Low · add a container to Shopping':status==='out'?'Out · add a container to Shopping':'Staple status needs review';
    row.assumptions=unique([...row.assumptions,'Staples use container/status tracking; recipe spoons and small amounts do not reduce the container.']);
    if(context.stateConflict){row.covered=false;row.issue='unit_mismatch';row.issueLabel='These staple descriptions have different food states. Review them in At home; saved containers stay unchanged.';}
    else if(context.reviewEdit){row.issue='unit_mismatch';row.issueLabel='Review the edited staple amount in At home. Its container and status stay unchanged.';}
    else if(status==='unknown'){row.issue='unit_unknown';row.issueLabel='Review this staple’s stock status in At home. Its saved container stays unchanged.';}
    else if(!context.smallStaple){row.issue='unit_mismatch';row.issueLabel='This recipe uses a larger or unmeasured staple amount. Check the container in At home; its saved quantity stays unchanged.';}
    continue;
   }
   if(context.reviewEdit){row.issue='unit_mismatch';row.issueLabel='The edited unit does not match this ingredient. Review it in At home; the saved stock stays unchanged.';continue;}
   if(!context.measurable){row.issue=context.stateConflict?'unit_mismatch':row.required===null?'amount_unknown':'unit_unknown';row.issueLabel=context.stateConflict?'Recipe lines describe different food states under the same ingredient. Review those amounts in At home; this stock stays unchanged.':context.invalid?'Pack contents need review in At home; no stock will be deducted.':'Amount or unit needs review in At home; no stock will be deducted.';if(!mode&&wanted!==null&&wanted>0&&edits.has(row.id))throw Error('Review the pantry unit for '+row.name+' before deducting it.');continue;}
   const candidates=/** @type {Array<{source:ConversionSource,relation:ConversionPath}>} */ ([]),unconverted=/** @type {ConversionSource[]} */ ([]),recipeEstimated=row.estimated,recipeAssumptions=[...row.assumptions];
   for(const source of sources){
    const quantity=physical[source.stockKey]||0;if(!(quantity>0)||source.canonicalKey!==row.canonicalKey)continue;
    let relation=null;
    if(source.excluded||source.state!==context.state)unconverted.push(source);
    else if(source.pack?.invalid)unconverted.push(source);
    else{
     // Matching literal units need no package-size assumption. Otherwise use
     // only this exact stock record's checked contents and food-specific rules.
     if(source.info.unit===row.unit&&source.info.known)relation={factor:source.info.factor,estimated:false,assumptions:[]};
     else{
      const from=source.pack||{unit:source.info.unit,factor:source.info.factor,estimated:false,assumptions:[]},path=bridge(/** @type {string} */ (context.food),from.unit,/** @type {string} */ (row.unit));
      if(path&&(source.info.known||source.pack))relation={factor:from.factor*path.factor,estimated:from.estimated||path.estimated,assumptions:unique([...from.assumptions,...path.assumptions])};
     }
     if(!relation||!Number.isFinite(relation.factor)||relation.factor<=0)unconverted.push(source);
     else{const available=quantity*relation.factor;if(!valid(available)||!valid(row.owned+available))throw Error('Review the converted pantry amounts before cooking.');if(available===0){unconverted.push(source);continue;}row.owned+=available;candidates.push({source,relation});}
    }
   }
   row.canDeduct=row.owned>0||unconverted.length===0;
   if(unconverted.length&&wanted!==null&&wanted>0){row.issue='unit_mismatch';row.issueLabel=unconverted.some(source=>source.excluded)?'Some At home amounts need ingredient identity review. Those quantities stay unchanged; review them in At home.':'At home has '+unconverted.map(source=>physical[source.stockKey]+' '+source.sourceUnit+' of '+source.food).join(', ')+'. Reviewed pack contents or a food-specific conversion are needed. This stock stays unchanged; review At home.';}
   if(!mode&&edits.has(row.id)&&!row.canDeduct&&wanted!==null&&wanted>0)throw Error('Review the pantry unit for '+row.name+' before deducting it.');
   let needed=Math.min(row.owned,Math.max(0,wanted||0));
   for(const {source,relation}of candidates){
    if(!(needed>0))break;const before=physical[source.stockKey],sourceQuantity=Math.min(before,needed/relation.factor),quantity=Math.min(needed,sourceQuantity*relation.factor),left=before-sourceQuantity;
    if(!valid(sourceQuantity)||!valid(quantity)||!valid(left))throw Error('Review the pantry conversion before cooking.');
    if(sourceQuantity===0||quantity===0||left===before){row.issue='unit_mismatch';row.issueLabel='This converted amount is too small to record safely in its stored unit. Review the amount in At home; this stock stays unchanged.';continue;}
    if(left>0)physical[source.stockKey]=left;else delete physical[source.stockKey];needed=Math.max(0,needed-quantity);row.deduct+=quantity;
    row.allocations.push({stockKey:source.stockKey,sourceUnit:source.sourceUnit,sourceQuantity,unit:/** @type {string} */ (row.unit),quantity,estimated:recipeEstimated||relation.estimated,assumptions:unique([...recipeAssumptions,...relation.assumptions])});row.estimated||=relation.estimated;row.assumptions=unique([...row.assumptions,...relation.assumptions]);
   }
   row.remaining=Math.max(0,row.owned-row.deduct);
  }
  const used=rows.filter(row=>row.deduct>0).map(row=>({id:row.id,key:row.name,unit:/** @type {string} */ (row.unit),required:row.deduct,estimated:row.estimated,assumptions:row.assumptions,allocations:row.allocations}));
  return {rows,remainingStock:physical,used,issues:rows.filter(row=>row.issue).map(row=>({id:row.id,message:row.issueLabel})),preservesSourceUnits:true};
 }
 /** @param {DeductionInput} [input] @returns {import('./types/pantry-workflow').DeductionResult} */
 function proposal({stock,ingredients,amounts,id=defaultId,conversion}=/** @type {DeductionInput} */ ({})){
  if(conversion!==undefined&&conversion!==null)return convertedProposal({stock,ingredients,amounts,id,conversion});
  if(!Array.isArray(ingredients)||ingredients.length>500)throw Error('Review the recipe ingredients before cooking.');
  const {values,names}=stockData(stock,id),remaining={...values},rows=/** @type {DeductionRow[]} */ ([]),byId=/** @type {Map<string,DeductionRow>} */ (new Map());
  for(const [index,ingredient]of ingredients.entries()){
   const food=name(ingredient?.key||ingredient?.name),display=name(ingredient?.name)||food||'Ingredient '+(index+1),info=measure(ingredient?.unit);
   const measured=valid(ingredient?.required),required=measured?round(/** @type {number} */ (ingredient.required)*info.factor):null;
   if(required!==null&&!valid(required))throw Error('Check the cooked serving amounts.');
   const rowId=food&&info.unit?canonicalId(food,info.unit,id):'unmeasured-'+index;
   const existing=byId.get(rowId);
   if(existing){existing.required=required===null||existing.required===null?null:round(existing.required+required);if(existing.required!==null&&!valid(existing.required))throw Error('Check the cooked serving amounts.');continue;}
   const row=/** @type {DeductionRow} */ ({id:rowId,name:display,unit:info.unit||null,required,owned:0,deduct:0,remaining:0,canDeduct:false,issue:null,issueLabel:''});
   rows.push(row);byId.set(row.id,row);
  }
  const edits=/** @type {Map<string,number>} */ (new Map());
  if(amounts!==undefined){
   if(!Array.isArray(amounts)||amounts.length>rows.length)throw Error('Review the used ingredient amounts.');
   for(const edit of amounts){
    if(!object(edit)||!byId.has(edit.id)||edits.has(edit.id)||!valid(edit.quantity))throw Error('Review the used ingredient amounts.');
    const row=/** @type {DeductionRow} */ (byId.get(edit.id)),info=measure(edit.unit);
    if(edit.quantity!==0&&(!info.known||info.unit!==row.unit||!valid(edit.quantity*info.factor)))throw Error('Choose a compatible unit for '+row.name+'.');
    edits.set(edit.id,round(edit.quantity*info.factor));
   }
  }
  for(const row of rows){
   const measurable=!!row.unit&&known.has(row.unit)&&row.required!==null&&row.id.indexOf('unmeasured-')!==0;
   const wanted=edits.has(row.id)?/** @type {number} */ (edits.get(row.id)):row.required;
   row.owned=remaining[row.id]||0;row.remaining=row.owned;
   if(!measurable){row.issue=row.required===null?'amount_unknown':'unit_unknown';row.issueLabel='Amount or unit needs review in At home; no stock will be deducted.';continue;}
   const food=row.id.slice(0,row.id.lastIndexOf('|'));
   const incompatible=Object.keys(remaining).filter(key=>names.get(key)===food&&key!==row.id&&remaining[key]>0);
   row.canDeduct=row.owned>0||!incompatible.length;
   if(incompatible.length&&row.owned<(wanted||0)){
    row.issue='unit_mismatch';row.issueLabel='At home also has '+incompatible.map(key=>remaining[key]+' '+key.slice(key.lastIndexOf('|')+1)).join(', ')+'. Review those units; they will not be converted or deducted.';
   }
   if(edits.has(row.id)&&!row.canDeduct&&/** @type {number} */ (wanted)>0)throw Error('Review the pantry unit for '+row.name+' before deducting it.');
   const used=Math.min(row.owned,Math.max(0,wanted||0));row.deduct=round(used);row.remaining=round(Math.max(0,row.owned-used));
   remaining[row.id]=row.remaining;
  }
  const remainingStock=Object.fromEntries(Object.entries(remaining).filter(([,amount])=>amount>0));
  const used=rows.filter(row=>row.deduct>0).map(row=>({id:row.id,key:row.name,unit:/** @type {string} */ (row.unit),required:row.deduct}));
  return {rows,remainingStock,used,issues:rows.filter(row=>row.issue).map(row=>({id:row.id,message:row.issueLabel}))};
 }
 return Object.freeze({proposal,measure,stockData});
});
