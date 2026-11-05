/* Deterministic spoken phrasing. Never calculate amounts, shorten instructions
 * or infer cooking advice: the recipe's numbers and safety wording stay intact. */
(function(root,factory){
 'use strict';
 const api=factory(typeof module==='object'&&module.exports?require('./bb-cook-method.js'):root?.BBCookMethod);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBCookSpeechText=api;
})(typeof window==='undefined'?null:window,function(method){
 'use strict';
 const units={g:['gram','grams'],kg:['kilogram','kilograms'],mg:['milligram','milligrams'],ml:['millilitre','millilitres'],cl:['centilitre','centilitres'],l:['litre','litres'],tsp:['teaspoon','teaspoons'],tsps:['teaspoon','teaspoons'],tbsp:['tablespoon','tablespoons'],tbsps:['tablespoon','tablespoons'],min:['minute','minutes'],mins:['minute','minutes'],hr:['hour','hours'],hrs:['hour','hours'],sec:['second','seconds'],secs:['second','seconds']};
 const plurals={onion:'onions',carrot:'carrots',potato:'potatoes',tomato:'tomatoes',egg:'eggs',clove:'cloves',pepper:'peppers',mushroom:'mushrooms',pea:'peas',bean:'beans',chickpea:'chickpeas',lentil:'lentils',fillet:'fillets',breast:'breasts',thigh:'thighs',sausage:'sausages',prawn:'prawns',wrap:'wraps',noodle:'noodles',nut:'nuts',olive:'olives',lemon:'lemons',lime:'limes',apple:'apples',pear:'pears',banana:'bananas',orange:'oranges',courgette:'courgettes',aubergine:'aubergines',shallot:'shallots',leek:'leeks',cucumber:'cucumbers',parsnip:'parsnips',flatbread:'flatbreads',chop:'chops',baguette:'baguettes',leaf:'leaves',loaf:'loaves'};
 const singles=Object.fromEntries(Object.entries(plurals).map(([single,plural])=>[plural,single]));
 const clean=value=>String(value??'').replace(/[\u00a0\u202f]/g,' ').replace(/\s+/g,' ').trim();
 const lower=value=>value.replace(/^[A-Z](?=[a-z])/,letter=>letter.toLowerCase());
 const finish=value=>/[.!?]$/.test(value)?value:value+'.';
 const one=value=>/^(?:1(?:\.0+)?|one)$/i.test(value.trim());
 function plain(value){
  return clean(value)
   .replace(/≈\s*/g,'approximately ')
   .replace(/(\d(?:[\d.,]*\d)?)\s*°\s*([CF])\b/gi,(_,amount,scale)=>amount+(one(amount)?' degree ':' degrees ')+(scale.toUpperCase()==='C'?'Celsius':'Fahrenheit'))
   .replace(/(\d(?:[\d.,]*\d)?)\s*([CF])\b/g,(_,amount,scale)=>amount+(one(amount)?' degree ':' degrees ')+(scale==='C'?'Celsius':'Fahrenheit'))
   .replace(/\bgas\s+(?!mark\b)(\d+)\b/gi,(_,mark)=>'gas mark '+mark)
   .replace(/(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])\s*(kg|mg|ml|cl|tbsps?|tsps?|mins?|hrs?|secs?|g|l)\b/gi,(_,amount,unit)=>amount+' '+units[unit.toLowerCase()][one(amount)?0:1])
   .replace(/(\d)\s*[–—]\s*(?=\d)/g,'$1 to ')
   .replace(/([\d¼½¾⅓⅔⅛⅜⅝⅞])\s*[×x]\s*(?=\d)/gi,'$1 times ')
   .replace(/(\d)\s*%/g,'$1 per cent');
 }
 function inflectName(value,amount){
  const words=value.split(' '),last=words.at(-1),base=singles[last]||last;
  if(plurals[base])words[words.length-1]=one(amount)?base:plurals[base];
  return words.join(' ');
 }
 function phrase({name,quantity}={}){
  const item=lower(plain(name)),amount=lower(plain(quantity));
  if(!item||!amount)return '';
  // Counts such as “2 medium” use the actual ingredient noun, never an
  // invented package size. Only known count nouns are inflected.
  const countNumber='(?:\\d+(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+|\\s*[¼½¾⅓⅔⅛⅜⅝⅞])?|\\d+\\/\\d+|[¼½¾⅓⅔⅛⅜⅝⅞])';
  const counted=amount.match(new RegExp('^(approximately )?('+countNumber+')(?:\\s+(small|medium|large|each|whole))?$','i'));
  if(counted)return (counted[1]||'')+counted[2]+(counted[3]&&counted[3]!=='each'?' '+counted[3]:'')+' '+inflectName(item,counted[2]);
  const pack=amount.match(new RegExp('^(approximately )?('+countNumber+') times (\\d+(?:\\.\\d+)?) (grams|millilitres) (tin|tins|can|cans)$'));
  if(pack)return (pack[1]||'')+pack[2]+' '+(one(pack[2])?pack[5].replace(/s$/,''):pack[5].replace(/s$/,'')+'s')+' of '+item+', '+pack[3]+' '+pack[4]+(one(pack[2])?'':' each');
  if(/^(?:to taste|as needed|for (?:frying|greasing|dusting|serving))\b/i.test(amount))return item+', '+amount;
  const fullName=item.split(/\W+/).map(word=>singles[word]||word).join(' ');
  const quantityName=amount.split(/\W+/).map(word=>singles[word]||word).join(' ');
  if((' '+quantityName+' ').includes(' '+fullName+' '))return amount.replace(/^(\d+(?:\.\d+)? (?:grams?|kilograms?|millilitres?|litres?)) (?=[a-z])/i,'$1 of ');
  const namedCount=amount.match(/^(\d+(?:\.\d+)?)(.*?)\s+([a-z]+)$/i),head=item.split(' ').at(-1);
  if(namedCount&&plurals[singles[head]||head]&&(singles[namedCount[3]]||namedCount[3])===(singles[head]||head))return namedCount[1]+namedCount[2]+' '+inflectName(item,namedCount[1]);
  const tail=amount.match(/^(.*?)(,?\s+(?:plus\b|to taste\b|as needed\b|for serving\b).*)$/i);
  if(tail)return tail[1]+' of '+item+(tail[2].startsWith(',')?tail[2]:', '+tail[2].trim());
  const condition=amount.match(/^(.*?\b(?:grams?|kilograms?|millilitres?|litres?))\s+(dry|uncooked|cooked|drained|frozen)$/i);
  if(condition)return condition[1]+' of '+condition[2]+' '+item;
  return amount+' of '+item;
 }
 function ingredient(value={}){
  const food=phrase(value);if(!food)return 'Check the ingredient and its amount on screen. Say “next ingredient” when you’re ready.';
  const index=Number.isInteger(value.index)&&value.index>=0?value.index:0;
  const transitions=['First up, grab ','Next, get ','You’ll also need ','Then, grab '];
  return finish(transitions[index===0?0:1+(index-1)%3]+food)+' Say “next ingredient” when you’re ready.';
 }
 function answer(value={}){
  const food=phrase(value);return food?finish('You’ll need '+food):'Check the recipe for that ingredient’s amount.';
 }
 function step(value={}){
  const text=plain(method?.normalizeStep(value.text)??value.text);if(!text)return '';
  const index=Number.isInteger(value.index)&&value.index>=0?value.index:0,count=Number.isInteger(value.count)&&value.count>index?value.count:null;
  const cue='Step '+(index+1)+(count?' of '+count:'')+'. ';
  const transition=index===0?'First up, ':count&&index===count-1?'To finish, ':index%2?'Next, ':'Now, ';
  const ready=/^(?:first(?: up)?|next|then|now|finally|to finish)[,:]\s/i.test(text)?text:transition+lower(text);
  return cue+finish(ready)+' Say “next step” when you’re ready.';
 }
 return Object.freeze({plain,phrase,ingredient,answer,step});
});
