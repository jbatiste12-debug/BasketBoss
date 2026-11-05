/* Shared, pure recipe-method parsing and conservative instruction cleanup.
 * Array entries remain step cards: normalization never splits or merges cards.
 * sourceMethod is the corresponding pre-cleanup text, for timer extraction.
 * Changes are intentionally narrow: adjacent unmeasured duplicate sentences,
 * equivalent pink/opaque prawn instructions, and explicit same-food prep order.
 * No ingredients, quantities, temperatures or cooking times are inferred.
 */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBCookMethod=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const METHOD_FIELDS=['method','steps','instructions','directions'];
 const TEXT_FIELDS=['text','instruction','description','step','content','body'];
 const METHOD_HEADING=/^(?:(?:cooking|preparation)\s+)?(?:method|instructions|directions|steps|preparation)\s*:?$/i;
 const OTHER_HEADING=/^(?:ingredients(?:\s*\([^)]*\))?|nutrition(?:al information)?|allergens?|notes?|tips?|servings?|equipment|shopping list|chef(?:'s)? tips?)\s*:?$/i;
 const BATCH_GUIDANCE=/^Cook in batches in a properly hot pan so the protein colours and (?:the )?vegetables stay crisp-tender instead of steaming[.!]?$/i;
 const STEP_MARKER=/^\s*(?:[-*+•]\s+|\d+[.):]\s+|\d+\s+[-–—]\s+|step\s+\d+(?:\s*[.):–—-]\s*|\s+|$))/i;

 function plain(value){
  return String(value).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/?(?:p|li|ol|ul|div)\b[^>]*>/gi,'\n')
   .replace(/\*\*/g,'').replace(/__/g,'')
   .replace(/`([^`]+)`/g,'$1').replace(/\r\n?/g,'\n').trim();
 }
 function instructionText(value){
  const text=stripMarker(heading(value)),label=text;
  return METHOD_HEADING.test(label)||OTHER_HEADING.test(label)||/^[#*+`_\s-]*$/.test(label)?'':text;
 }
 function stripMarker(value){
  return value.replace(STEP_MARKER,'').trim();
 }
 function heading(value){return value.replace(/^\s*#{1,6}\s*/,'').replace(/\s*#+\s*$/,'').trim();}
 function stepText(value,seen){
  if(typeof value==='string')return plain(value).replace(/\s*\n\s*/g,' ').replace(/\s+/g,' ').trim();
  if(!value||typeof value!=='object'||Array.isArray(value)||seen.has(value))return '';
  seen.add(value);
  for(const field of TEXT_FIELDS){
   const text=stepText(value[field],seen);if(text)return text;
  }
  return '';
 }
 function parseString(value){
  const lines=plain(value).split('\n').filter(line=>!/^\s*```/.test(line));
  const start=lines.findIndex(line=>METHOD_HEADING.test(heading(line)));
  const output=[];let active=start<0,listed=false,pendingStep=false;
  for(let index=0;index<lines.length;index++){
   const raw=lines[index],trimmed=raw.trim();if(!trimmed)continue;
   const label=heading(trimmed);
   if(METHOD_HEADING.test(label)){active=true;listed=false;continue;}
   if(OTHER_HEADING.test(label)){
    if(active&&output.length)break;
    active=false;continue;
   }
   if(!active||index<start)continue;
   // Section labels and recipe metadata are not instruction cards.
   if(/^#{1,6}\s+/.test(trimmed)&&!/^step\s+\d+\b/i.test(label))continue;
   if(/^(?:serves|servings|prep(?:aration)? time|cook(?:ing)? time|total time)\s*:/i.test(label))continue;
   const candidate=label===trimmed?trimmed:label;
   const marked=STEP_MARKER.test(candidate);
   const text=stripMarker(candidate).replace(/\s+/g,' ').trim();
   if(!text){listed=marked;pendingStep=marked;continue;}
   // A wrapped list item remains one card; plain unlisted lines are cards.
   if(!marked&&listed&&output.length&&!pendingStep)output[output.length-1]+=' '+text;
   else output.push(text);
   listed=marked||listed;pendingStep=false;
  }
  return output;
 }
 function extract(value,seen){
  if(typeof value==='string')return parseString(value);
  if(!value||typeof value!=='object'||seen.has(value))return [];
  seen.add(value);
  if(Array.isArray(value)){
   // Preserve source positions, including invalid entries beside valid cards.
   const cards=value.map(item=>instructionText(stepText(item,new Set())));
   return cards.some(Boolean)?cards:[];
  }
  for(const field of METHOD_FIELDS){
   const cards=extract(value[field],seen);if(cards.some(Boolean))return cards;
  }
  const text=instructionText(stepText(value,new Set()));return text?[text]:[];
 }
 function sourceMethod(value){return extract(value,new Set());}

 function sentences(text){
  const output=[];let start=0;
  for(let index=0;index<text.length;index++){
   const prefix=text.slice(start,index+1),tail=text.slice(index+1);
   const abbreviation=/(?:\b(?:e\.g|i\.e|Mr|Mrs|Dr|approx|min|mins|hr|hrs|tsp|tbsp)|\b[A-Z])\.$/.test(prefix)&&!(/\d\s*°?\s*[CF]\.$/.test(prefix));
   if(/[.!?]/.test(text[index])&&/^\s+[A-Z“"(]/.test(tail)&&!abbreviation){output.push(text.slice(start,index+1).trim());start=index+1;}
  }
  if(text.slice(start).trim())output.push(text.slice(start).trim());
  return output;
 }
 function key(text){return text.toLowerCase().replace(/[.!?]+$/,'').replace(/\s+/g,' ').trim();}
 function quantitative(text){return /\d|[¼½¾⅓⅔⅛⅜⅝⅞]|\b(?:once|twice|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|again|repeat|remaining|another|further|overnight|seconds?|minutes?|hours?|secs?|mins?|hrs?|tsp|tbsp|teaspoons?|tablespoons?|grams?|kilograms?|millilitres?|milliliters?|litres?|liters?|cups?|ounces?|pounds?)\b/i.test(text);}
 function deduplicate(parts){
  const output=[];
  for(const part of parts){
   const previous=output[output.length-1];
   // Quantified repetitions can be intentional repeated additions or stages.
   if(previous&&key(previous)===key(part)&&!quantitative(part))continue;
   output.push(part);
  }
  return output;
 }
 function prawnInstruction(text){
  const match=text.replace(/[.!?]$/,'').match(/^((?:Add (?:the )?(prawns?|shrimp) and cook|Cook (?:the )?(prawns?|shrimp)) until )((?:pink and opaque|opaque and pink)(?: all the way through| throughout)?)(;[^]*)?$/i);
  if(!match)return null;
  return {prefix:match[1],food:(match[2]||match[3]).toLowerCase().replace(/s$/,''),condition:match[4],tail:match[5]||''};
 }
 function mergePrawns(parts){
  const output=[];
  for(const part of parts){
   const previous=output[output.length-1],left=previous&&prawnInstruction(previous),right=prawnInstruction(part);
   if(!left||!right||left.food!==right.food||/^Add\b/i.test(right.prefix)||quantitative(previous)||quantitative(part)){output.push(part);continue;}
   const condition=/all the way through|throughout/i.test(left.condition)?left.condition:right.condition;
   let tail=left.tail;
   if(right.tail&&key(right.tail)!==key(left.tail))tail+=right.tail;
   output[output.length-1]=left.prefix+condition+tail+'.';
  }
  return output;
 }
 function foodKey(value){return value.toLowerCase().replace(/^the\s+/,'').replace(/\s+/g,' ').trim();}
 function explicitPrep(text){
  const pat=text.match(/^Pat (.+?) dry before (searing|browning|frying|cooking)\b/i);
  if(pat)return {food:foodKey(pat[1]),verbs:pat[2]==='searing'?/\bsear(?:ing)?\b/i:pat[2]==='browning'?/\bbrown(?:ing)?\b/i:pat[2]==='frying'?/\b(?:fry|frying)\b/i:/\b(?:cook|sear|fry|brown)\b/i};
  const cut=text.match(/^Cut (.+?) into even pieces[.!]?$/i);
  return cut?{food:foodKey(cut[1]),verbs:/\b(?:cook|sear|fry|brown)\b/i}:null;
 }
 function matchingCook(text,prep){
  const action=/^(?:(?:Add|Return)\b.+?\band\s+)?(?:Cook|Sear|Fry|Stir-fry|Brown|Sauté|Saute|Grill|Roast|Bake)\b/i.test(text);
  return action&&prep.verbs.test(text)&&foodKey(text).includes(prep.food);
 }
 function orderPreparation(parts){
  const output=[];
  for(const part of parts){
   // This known appended sentence contains independent prep and doneness.
   const cut=part.match(/^(Cut .+? into even pieces) and (cook .+)$/i);
   if(cut)output.push(cut[1]+'.',cut[2][0].toUpperCase()+cut[2].slice(1));else output.push(part);
  }
  for(let index=0;index<output.length;index++){
   const prep=explicitPrep(output[index]);if(!prep)continue;
   const target=output.findIndex((part,candidate)=>candidate<index&&matchingCook(part,prep));
   if(target>=0){const [part]=output.splice(index,1);output.splice(target,0,part);}
  }
  // A set-aside instruction for a named protein must follow its cook action.
  for(let index=0;index<output.length;index++){
   const match=output[index].match(/^Set (?:the )?(salmon|prawns?|shrimp|chicken|beef|pork|tofu) aside[.!]?$/i);
   if(!match)continue;
   const target=output.findIndex((part,candidate)=>candidate>index&&matchingCook(part,{food:foodKey(match[1]),verbs:/\b(?:cook|sear|fry|brown|bake|roast|grill)\b/i}));
   if(target>=0){const [part]=output.splice(index,1);output.splice(target,0,part);}
  }
  return output;
 }
 function ingredientEvidence(context){
  const list=Array.isArray(context)?context:context?.ingredients;
  if(!Array.isArray(list)||!list.length)return null;
  const names=list.map(item=>typeof item==='string'?item:Array.isArray(item)?item[0]:item?.name||item?.ingredient||'');
  if(names.some(name=>!name||typeof name!=='string'))return null;
  // Only explicit categories give enough evidence to rule vegetables out;
  // unclassified names must not trigger ingredient-dependent deletion.
  const categorized=list.every(item=>Array.isArray(item)&&typeof item[3]==='string'&&item[3].trim());
  return categorized?{vegetables:list.some(item=>/vegetable/i.test(item[3]))}:null;
 }
 function orderTechnique(parts,context){
  const output=parts.slice(),evidence=ingredientEvidence(context);
  for(let index=0;index<output.length;index++){
   if(!BATCH_GUIDANCE.test(output[index]))continue;
   if(evidence&&!evidence.vegetables)output[index]='Cook in batches in a properly hot pan so the protein colours instead of steaming.';
   const target=output.findIndex((part,candidate)=>candidate<index&&/^(?:(?:Add|Return)\b.+?\band\s+)?(?:Cook|Sear|Fry|Stir-fry|Brown|Sauté|Saute|Grill|Roast|Bake)\b/i.test(part));
   if(target>=0){const [part]=output.splice(index,1);output.splice(target,0,part);}
  }
  return output;
 }
 function normalizeStep(value,context){
  const text=instructionText(stepText(value,new Set()));if(!text)return '';
  return deduplicate(orderTechnique(orderPreparation(mergePrawns(deduplicate(sentences(text)))),context)).join(' ');
 }
 function normalizeMethod(value,context){
  const recipeContext=context||(value&&typeof value==='object'&&!Array.isArray(value)?value:undefined);
  return sourceMethod(value).map(card=>normalizeStep(card,recipeContext));
 }
 return Object.freeze({sourceMethod,normalizeStep,normalizeMethod,parseMethod:normalizeMethod});
});
