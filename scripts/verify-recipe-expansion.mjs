#!/usr/bin/env node
// Local authoring gate. The authoritative Premium baseline stays in Git/D1,
// never copied into a publicly served JSON file by this script.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BASELINE='9458903c4ba06fc54a558fbe05886bfa5326ab98';
const MARKETS=['UK','Guernsey','Jersey','US'];
const FULL_ALLOCATION=Object.freeze({'general-dinner':100,'kid-friendly':40,'date-night':19,dessert:20});
const THRESHOLD=.70;
const args=process.argv.slice(2);
const option=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
const mode=option('--mode','pilot');
const staging=path.resolve(option('--staging-dir',path.resolve(ROOT,'../basketboss-expansion-staging')));
const contentOnly=args.includes('--content-only');
const failures=[],warnings=[];
const check=(condition,message)=>{if(!condition)failures.push(message);return Boolean(condition);};
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const gitJSON=file=>JSON.parse(execFileSync('git',['show',`${BASELINE}:${file}`],{cwd:ROOT,encoding:'utf8',maxBuffer:20*1024*1024}));
const asRecipes=value=>Array.isArray(value)?value:value?.recipes;
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
const slugPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const stop=new Set(['a','an','the','and','with','in','on','of','for','to','from','style']);
const synonyms=new Map(Object.entries({shrimp:'prawn',prawns:'prawn',shrimps:'prawn',chili:'chilli',chillies:'chilli',chilies:'chilli',cilantro:'coriander',scallion:'spring-onion',scallions:'spring-onion',garbanzos:'chickpea',garbanzo:'chickpea',chickpeas:'chickpea',cannellini:'white-bean',beans:'bean',tomatoes:'tomato',passata:'tomato',penne:'pasta',rigatoni:'pasta',spaghetti:'pasta',linguine:'pasta',tagliatelle:'pasta',macaroni:'pasta',fusilli:'pasta',farfalle:'pasta',courgettes:'courgette',zucchini:'courgette',aubergines:'aubergine',eggplant:'aubergine',noodles:'noodle',potatoes:'potato',tortillas:'tortilla',wraps:'tortilla',capsicum:'pepper'}));
export function tokens(value){
 return new Set((String(value||'').toLowerCase().match(/[a-z0-9]+/g)||[]).filter(t=>!stop.has(t)).map(t=>synonyms.get(t)||t));
}
export function similarity(a,b){const x=a instanceof Set?a:tokens(a),y=b instanceof Set?b:tokens(b);const union=new Set([...x,...y]);return union.size?[...x].filter(t=>y.has(t)).length/union.size:0;}
const fold=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,'').replace(/[-–—]/g,' ').replace(/\s+/g,' ').trim();
const ingredientNames=r=>(r.ingredients||[]).map(i=>Array.isArray(i)?i[0]:i.key||i.name||'');
const textOf=r=>[r.name,r.category,r.tag,...ingredientNames(r)].join(' ').toLowerCase();
const normalizeProtein=value=>fold(value).replace(/shrimps?|prawns?/g,'prawn').replace(/white ?beans?|black ?beans?|butter ?beans?|kidney ?beans?|cannellini|black eyed ?beans?/g,'bean').replace(/\bbeans\b/g,'bean').replace(/\blentils\b/g,'lentil').replace(/\bchickpeas\b/g,'chickpea').replace(/^(?:salmon|tuna|white ?fish|cod|haddock|pollock|halibut|bream|mackerel|sardine|sardines|sea ?bass|monkfish)$/,'fish');
const PROTEINS=[['prawn',/\bprawns?|shrimps?\b/],['fish',/\bsalmon|tuna|cod|haddock|pollock|halibut|bream|mackerel|sardines?|sea bass|monkfish|white fish|anchov(?:y|ies)\b/],['chicken',/\bchicken\b/],['turkey',/\bturkey\b/],['beef',/\bbeef|veal|brisket|sirloin|ribeye|steak\b/],['pork',/\bpork|bacon|ham|gammon|pancetta|chorizo|sausages?\b/],['lamb',/\blamb|mutton\b/],['duck',/\bduck\b/],['goat',/\bgoat\b/],['venison',/\bvenison\b/],['quail',/\bquail\b/],['rabbit',/\brabbit\b/],['lobster',/\blobster|langoustines?\b/],['crab',/\bcrab\b/],['mussel',/\bmussels?\b/],['scallop',/\bscallops?\b/],['squid',/\bsquid|calamari\b/],['tofu',/\btofu|tempeh|quorn\b/],['lentil',/\blentils?|dalia\b/],['chickpea',/\bchickpeas?|garbanzo|chana|gram flour|socca\b/],['bean',/\bbeans?|cannellini|lobio\b/],['pea',/\bpeas?|edamame\b/],['mushroom',/\bmushrooms?\b/],['egg',/\beggs?|omelette|shakshuka|cilbir\b/]];
function protein(r){
 const title=fold(r.name);
 if(/nougat|baklava|halva|ladoo|truffles?/.test(title)&&/almond|pistachio|walnut|hazelnut|cashew|peanut|pecan/.test(fold(ingredientNames(r).join(' '))))return 'nuts';
 const main=ingredientNames(r).filter(n=>! /\b(stock|broth|sauce|seasoning|paste|powder)\b/i.test(n));
 for(const [name,rx] of PROTEINS)if(rx.test(title)&&!(name==='beef'&&/cauliflower|tuna|mushroom|aubergine/.test(title)))return name;
 for(const n of main)for(const [name,rx] of PROTEINS)if(rx.test(fold(n)))return name;
 if(/almond|pistachio|walnut|hazelnut|cashew|peanut|pecan/.test(title))return 'nuts';
 if(/cheese|halloumi|mozzarella|ricotta|feta|cheddar|parmesan|paneer|burrata/.test(title))return 'cheese';
 return 'plant';
}
// Structural bases distinguish a true dish form, not a renamed pasta shape or
// a different protein. Cuisine labels alone never create a new fingerprint.
const STRUCTURAL_BASES=[
 ['whipped-cooked-sugar-confection',/nougat/],['open-rye-rice-pasty',/karelian.*past/],['steamed-oat-lentil-pudding',/haggis/],['shellfish-bisque',/bisque/],['bread-egg-boat',/adjarian.*bread boats|khachapuri/],['bread-dumpling',/bread.*dumplings?|knodel/],['rice-filled-cabbage',/cabbage rolls|sarma|golabki/],['batter-sausage-bake',/toad in the hole/],['smoked-fish-egg-rice',/kedgeree/],['leek-cheese-crumb-sausage',/glamorgan/],['roux-okra-stew',/gumbo/],['savoury-bread-custard',/savoury.*bread pudding|ham.*bread pudding/],['meringue-ice-cream-sponge',/baked alaska/],['fruit-biscuit-cobbler',/cobbler/],['chocolate-cream-confection',/truffles?/],['custard-filled-pastry',/custard pie/],['layered-filo-nuts',/\bbaklava\b/],['rolled-coconut-confection',/\bladoo|laddu\b/],['toasted-semolina-pudding',/\bhalva|halwa\b/],['syrup-fried-batter',/\bjalebi\b/],['baked-custard',/creme brulee|creme caramel|flan\b/],['fruit-baked-batter',/\bclafoutis\b/],['aerated-baked-egg',/\bsouffle/],['thin-crepe',/\bcrepes?|galettes?\b/],['rice-dough-mochi',/\bmochi|daifuku\b/],['fruit-water-ice',/\bgranita|sorbet\b/],['fried-choux',/\bchurros?\b/],['choux-puffs',/profiterole|eclair/],['sandwich-biscuit',/alfajores|sandwich biscuits/],['set-cream',/panna cotta|posset/],['fruit-poached',/poached (?:pears?|pumpkin|plums?|peaches?)/],['rice-porridge',/\bcongee|\bdalia|rice porridge/],['steamed-bean-pudding',/moi moi|steamed.*bean.*pudding/],['rice-macaroni-lentil',/\bkoshari|kushari\b/],['rice-lentil-pilaf',/\bmujadara\b/],['toasted-bread',/\bmigas\b/],['bread-chickpea-broth',/\blablebi\b/],['chickpea-flour-flatcake',/\bsocca\b/],['filled-filo-parcel',/\bbrik\b/],['stuffed-squid',/stuffed.*squid|squid.*stuffed/],['fish-kefta',/fish kefta|sardine kefta/],['rice-crepe',/banh xeo|\bdosas?\b/],['chopped-flatbread',/kottu roti/],['corn-masa-steamed',/\btamales?\b/],['corn-masa-filled-cake',/\bpupusas?\b/],['pressed-rice',/onigiri/],['nori-wrapped-rice',/gimbap|kimbap|sushi/],['omelette-wrapped-rice',/omurice/],['savoury-egg-custard',/chawanmushi|fish amok/],['wheat-wrapper-dumpling',/wonton|manti/],['filled-wheat-dumpling',/pierogi|pelmeni/],['steamed-bread-bun',/\bbao\b/],['semolina-cake',/steamed semolina/],['potato-terrine',/\bcausa\b/],['rice-egg-mince-bowl',/\bsoboro\b/],['fermented-wheat-soup',/\btrahana\b/],['fried-breaded-ragout',/ragout croquette/],['potato-rosti',/rosti|rösti/],['crumbed-risotto',/arancini/],['semolina-discs',/gnocchi alla romana/],['curd-dumpling',/cottage cheese dumpling|curd.*dumpling/],['filled-shortcrust',/empanada|hand pies?/],['filled-potato-filo',/samosa/],['egg-vegetable-patty',/foo young|foo yung/],['breaded-fishcake',/fishcakes?/],['meatball',/meatballs?|kofta|kefta/],['rice-cake',/rice cakes?|tteok/]
];
function base(r){
 const title=fold(r.name),names=fold(ingredientNames(r).join(' '));
 if(/potato pancakes?/.test(title)&&/flour/.test(names)&&/egg/.test(names))return 'potato-batter-pancake';
 for(const [key,rx] of STRUCTURAL_BASES)if(rx.test(title))return key;
 if(/rice pudding/.test(title))return 'milk-rice-pudding';
 if(/mousse/.test(title))return 'aerated-set-mousse';
 if(/cheesecake/.test(title))return 'cheese-biscuit-cake';
 if(/pavlova|eton mess/.test(title))return 'meringue-fruit-cream';
 if(/bread and butter pudding/.test(title))return 'bread-custard-pudding';
 if(/trifle/.test(title))return 'sponge-fruit-custard';
 if(/brownie|blondie/.test(title))return 'dense-baked-sweet-square';
 if(/cookies?|biscuits?/.test(title))return 'baked-biscuit';
 if(/crumble/.test(title))return 'fruit-crumble';
 if(/ice cream|kulfi/.test(title))return 'frozen-dairy';
 if(/cake|loaf|sponge|pudding/.test(title)&&/dessert|baking|sweet/.test(fold(r.category+' '+r.tag)))return 'baked-cake-pudding';
 const rules=[['gnocchi',/gnocchi/],['pasta',/pasta|penne|rigatoni|spaghetti|linguine|macaroni|tortellini|ravioli|orzo|fregola|nokedli/],['noodle',/noodle|vermicelli|soba|udon|rechta/],['pancake',/okonomiyaki|pancake/],['tortilla',/tortilla|taco|quesadilla|wrap/],['rice',/\brice|risotto|paella|bariis|pilaf|poha/],['potato',/potato|jacket|mash/],['bread',/bun|burger|bread|baguette|pita|pitta|naan|chapati|roti/],['pastry',/pastry|pie|tart/],['bean',/cannellini|white bean|black bean|kidney bean|butter bean/],['lentil',/lentil/],['chickpea',/chickpea/],['couscous',/couscous/],['bulgur',/bulgur/],['barley',/barley|freekeh/],['quinoa',/quinoa/]];
 return rules.find(([,rx])=>rx.test(title))?.[0]||rules.find(([,rx])=>rx.test(names))?.[0]||'vegetable';
}
const FLAVOR_COMPONENTS=[
 ['tomato',/tomato|passata/],['cream',/\bcream|creme|crème|soft cheese/],['coconut',/coconut/],['lemon',/lemon/],['lime',/\blime/],['orange',/\borange/],['tamarind',/tamarind/],['pomegranate',/pomegranate/],['apricot',/apricot/],['honey',/honey/],['cognac',/cognac|brandy/],['juniper',/juniper/],['cherry',/cherr/],['barberry',/barberr/],['apple-pear',/apple|pear/],['berry',/raspberr|strawberr|blueberr|blackberr/],['mango',/mango/],['lychee',/lychee/],['pineapple',/pineapple/],['banana',/banana/],['pumpkin',/pumpkin/],['chocolate',/chocolate|cocoa/],['caramel',/caramel|dulce de leche/],['vanilla',/vanilla/],['rose',/rose water|rosewater/],['orange-blossom',/orange blossom/],['almond',/almond/],['pistachio',/pistachio/],['walnut',/walnut/],['hazelnut',/hazelnut/],['peanut',/peanut/],['sesame',/sesame|tahini/],['mustard',/mustard/],['soy',/soy|tamari/],['vinegar',/vinegar/],['miso',/miso/],['gochujang',/gochujang|gochugaru/],['fermented-bean',/fermented black bean|doubanjiang/],['saffron',/saffron/],['turmeric',/turmeric/],['ginger',/ginger/],['cumin',/cumin/],['coriander',/coriander/],['mint',/\bmint/],['dill',/\bdill/],['basil',/\bbasil/],['oregano',/oregano/],['rosemary',/rosemary/],['sage',/\bsage/],['thyme',/thyme/],['tarragon',/tarragon/],['cinnamon',/cinnamon/],['cardamom',/cardamom/],['allspice',/allspice/],['fenugreek',/fenugreek/],['curry-leaf',/curry leaves|curry leaf/],['lemongrass',/lemongrass/],['fennel',/fennel/],['anise',/star anise/],['paprika',/paprika/],['sumac',/sumac/],['cheese',/cheddar|mozzarella|parmesan|pecorino|ricotta|feta|halloumi|paneer|burrata|gruyere|cheese/]
];
function flavor(r){
 const names=fold(ingredientNames(r).join(' ')),title=fold(r.name),t=names+' '+title;
 // Cajun/creamy-paprika renaming is explicitly the same sauce family.
 if(/cream|creme/.test(names)&&/cajun|paprika/.test(t))return 'cream-paprika';
 if(/pesto/.test(t))return 'pesto';
 if(/teriyaki/.test(t))return 'sweet-soy-ginger';
 if(/katsu/.test(t))return 'katsu-curry';
 if(/barbecue|\bbbq\b/.test(t))return 'barbecue';
 const parts=FLAVOR_COMPONENTS.filter(([,rx])=>rx.test(names)).map(([key])=>key);
 return [...new Set(parts)].sort().join('+')||'plain-savoury';
}
function method(r){
 const title=fold(r.name),steps=fold((r.method||r.steps||[]).join(' ')),tag=fold(r.tag),t=title+' '+tag+' '+steps;
 if(/nougat/.test(title))return 'sugar-boil-whip-set';
 if(/bisque/.test(title))return 'roast-simmer-strain';
 if(/salt baked/.test(title))return 'salt-crust-oven';
 if(/slow cook/.test(t))return 'slow-cooker';
 if(/air fry/.test(t))return 'air-fryer';
 if(/granita|sorbet|ice cream|kulfi/.test(title))return 'freeze';
 if(/mochi|tamale|bao|moi moi|steamed|amok|chawanmushi/.test(title))return 'steam';
 if(/confit/.test(title))return 'confit';
 if(/souffle|clafoutis|galette|bake|roast|pie|tart|baklava|empanada|samosa|arancini/.test(title))return 'oven';
 if(/churro|jalebi|brik|croquette|fritter/.test(title))return 'fry';
 if(/congee|porridge|soup|stew|curry|tagine|dhal|dal\b|kadhi|rasam|salta|khoresh|pozole|jjigae|laksa|moqueca/.test(title))return 'hob-simmer';
 if(/rice|pilaf|risotto|koshari|mujadara|bariis/.test(title)&&/simmer|steam|absorb|lid/.test(steps))return 'hob-absorption';
 if(/salad|no cook|sandwich|chaat/.test(title))return 'assemble';
 if(/pancake|okonomiyaki|galette|crepe|socca|stir fry|fried rice|migas|kottu/.test(title))return 'pan-fry';
 if(/grill|barbecue|\bbbq\b/.test(t))return 'grill';
 if(/traybake|tray bake|sheet pan|roast|oven|\bbake/.test(t))return 'oven';
 if(/simmer|poach|braise/.test(steps))return 'hob-simmer';
 if(/fry|skillet|pan|saute/.test(t))return 'pan-fry';
 if(/boil/.test(steps))return 'hob-boil';
 return 'assemble';
}
function vessel(r){
 const title=fold(r.name),text=title+' '+fold((r.method||r.steps||[]).join(' ')),technique=method(r);
 if(technique==='slow-cooker')return 'slow-cooker';
 if(technique==='air-fryer')return 'air-fryer-basket';
 if(technique==='steam')return 'steamer-or-steaming-pan';
 if(/skillet/.test(title))return 'skillet';
 if(/soup|stew|tagine|dhal|dal\b|congee|kadhi|rasam/.test(title))return 'heavy-saucepan-or-casserole';
 if(/pancake|okonomiyaki|crepe|fritter|stir fry|fried rice/.test(title))return 'frying-pan-or-wok';
 if(/tray|roast|sheet pan/.test(title))return 'roasting-tray';
 if(/pie|bake|gratin|lasagn|parmigiana|galette|clafoutis/.test(title))return 'ovenproof-baking-dish';
 if(technique==='oven'||technique==='confit')return 'ovenproof-dish-inferred';
 if(technique==='grill')return 'grill-pan-inferred';
 if(technique==='freeze')return 'freezer-container';
 if(technique==='assemble')return 'mixing-or-serving-bowl';
 if(technique==='hob-simmer'||technique==='hob-boil'||technique==='hob-absorption')return 'saucepan-inferred';
 return 'hob-pan-inferred';
}
export const inferredFingerprint=r=>[protein(r),base(r),flavor(r),method(r)].join('|');
const fingerprintObject=r=>r.culinaryFingerprint||r.fingerprint;
function declaredFingerprint(r){
 const f=fingerprintObject(r);
 return f&&typeof f==='object'?[f.primaryProtein,f.base,f.flavorProfile,f.cookingMethod,f.vessel].map(v=>fold(v)).join('|'):fold(f);
}
export function coreFlavorTokens(r){
 // Derive from actual ingredients: authored metadata cannot pad the comparison
 // denominator or omit inconvenient primary ingredients to make a clone pass.
 const names=ingredientNames(r).filter(n=>! /^(?:(?:extra virgin|virgin|light|toasted|cooking|olive|rapeseed|sunflower|sesame|vegetable) )?oil$|^(?:water|salt|sea salt|table salt|black pepper|ground pepper|onion|onions|garlic|garlic cloves?)$|\b(?:stock|broth|bouillon)\b/i.test(fold(n)));
 return tokens([...names,flavor(r)].join(' '));
}
export function culinaryConcept(r){return {primaryProtein:protein(r),base:base(r),flavorProfile:flavor(r),cookingMethod:method(r),vessel:vessel(r)};}
export function compareRecipes(additions,existing){
 const pairs=[];
 for(let n=0;n<additions.length;n++)for(const other of [...existing,...additions.slice(0,n)]){
  const r=additions[n],title=similarity(tokens(r.name),tokens(other.name)),ingredientFlavor=similarity(coreFlavorTokens(r),coreFlavorTokens(other)),fingerprintMatch=inferredFingerprint(r)===inferredFingerprint(other);
  if(title>THRESHOLD||ingredientFlavor>THRESHOLD||fingerprintMatch)pairs.push({candidate:r.id,other:other.id,title:round(title),ingredientFlavor:round(ingredientFlavor),fingerprintMatch});
 }
 return pairs;
}
export function applyLegacyOverrides(recipes,normalized,{normalizedFile=null,recipeFile=null}={}){
 const result={recipes:JSON.parse(JSON.stringify(recipes)),normalized:JSON.parse(JSON.stringify(normalized)),applied:[]};
 for(const [kind,file]of [['normalized',normalizedFile],['recipe',recipeFile]]){
  if(!file)continue;
  const data=readJSON(path.resolve(file));
  if(data.baselineCommit!==BASELINE||data.approved!==true||!Array.isArray(data.overrides))throw Error(`Unapproved or wrong-baseline legacy ${kind} overrides`);
  const target=kind==='normalized'?result.normalized:result.recipes,used=new Set();
  for(const row of data.overrides){
   const token=row.recipeId+'|'+row.ingredientIndex;
   if(used.has(token))throw Error(`Duplicate legacy override: ${token}`);used.add(token);
   const r=target.find(r=>r.id===row.recipeId),i=row.ingredientIndex;
   if(!r||!Number.isInteger(i)||i<0||i>=(r.ingredients||[]).length)throw Error(`Legacy override target missing: ${token}`);
   if(kind==='normalized'){
    const original=r.ingredients[i];
    if(original.key!==row.originalKey||original.quantity!==row.originalQuantity||original.unit!==row.originalUnit)throw Error(`Legacy normalized original mismatch: ${token}`);
    if(row.key!==row.originalKey||!Number.isFinite(row.quantity)||row.quantity<=0||typeof row.unit!=='string'||!row.unit)throw Error(`Invalid legacy normalized replacement: ${token}`);
    r.ingredients[i]={...original,key:row.key,quantity:row.quantity,unit:row.unit};
   }else{
    const original=r.ingredients[i],display=r.ingredient_display_lines?.[i];
    if(original[0]!==row.originalName||original[1]!==row.originalQuantity||display!==row.originalDisplayLine)throw Error(`Legacy recipe original mismatch: ${token}`);
    if(typeof row.quantity!=='string'||!row.quantity||typeof row.displayLine!=='string'||!row.displayLine)throw Error(`Invalid legacy recipe replacement: ${token}`);
    r.ingredients[i]=[original[0],row.quantity,...original.slice(2)];r.ingredient_display_lines[i]=row.displayLine;
   }
   result.applied.push({kind,recipeId:r.id,ingredientIndex:i,reason:row.reason});
  }
 }
 return result;
}
export function webpDimensions(buffer){
 if(buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WEBP')throw Error('not a WebP RIFF file');
 for(let pos=12;pos+8<=buffer.length;){
  const kind=buffer.toString('ascii',pos,pos+4),size=buffer.readUInt32LE(pos+4),data=pos+8;
  if(data+size>buffer.length)throw Error('truncated WebP chunk');
  if(kind==='VP8X'&&size>=10)return {width:buffer.readUIntLE(data+4,3)+1,height:buffer.readUIntLE(data+7,3)+1};
  if(kind==='VP8L'&&size>=5&&buffer[data]===0x2f){const bits=buffer.readUInt32LE(data+1);return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};}
  if(kind==='VP8 '&&size>=10&&buffer.toString('hex',data+3,data+6)==='9d012a')return {width:buffer.readUInt16LE(data+6)&0x3fff,height:buffer.readUInt16LE(data+8)&0x3fff};
  pos=data+size+(size%2);
 }
 throw Error('WebP dimensions missing');
}

async function main(){
 check(['pilot','batch','full'].includes(mode),'--mode must be pilot, batch or full');
 const batchNumber=Number(option('--batch','0'));
 const isBatch=mode==='batch',batchStart=325+(batchNumber-1)*44;
 if(isBatch)check(Number.isInteger(batchNumber)&&batchNumber>=1&&batchNumber<=4,'batch mode requires --batch 1, 2, 3 or 4');
 const additionsFile=option('--recipes',path.join(staging,isBatch?`batches/batch-${batchNumber}.recipes.json`:mode==='pilot'?'recipes-322-324.json':'recipes-322-500.json'));
 const normalizedFile=option('--normalized',path.join(staging,isBatch?`batches/batch-${batchNumber}.normalized.json`:mode==='pilot'?'recipes-322-324.normalized.json':'recipes-322-500.normalized.json'));
 const briefsFile=option('--image-briefs',path.join(staging,isBatch?`batches/batch-${batchNumber}.image-briefs.json`:mode==='pilot'?'image-briefs-322-324.json':'image-briefs-322-500.json'));
 const legacy=applyLegacyOverrides(asRecipes(gitJSON('recipes.json')),asRecipes(gitJSON('normalized-ingredient-database.json')),{normalizedFile:option('--legacy-normalization-overrides',null),recipeFile:option('--legacy-recipe-overrides',null)});
 const baseline=legacy.recipes,legacyNormalized=legacy.normalized;
 const additionsInput=fs.readFileSync(additionsFile),normalizedInput=fs.readFileSync(normalizedFile);
 const additions=asRecipes(JSON.parse(additionsInput));
 const normalized=asRecipes(JSON.parse(normalizedInput));
 const sourceHashes={recipes:crypto.createHash('sha256').update(additionsInput).digest('hex'),normalized:crypto.createHash('sha256').update(normalizedInput).digest('hex')};
 if(!Array.isArray(additions)||!Array.isArray(normalized))throw Error('staged recipe and normalized files must contain arrays or {recipes:[]}');
 const expected=isBatch?44:mode==='pilot'?3:179,total=baseline.length+additions.length;
 const expectedAllocation=isBatch?{'general-dinner':batchNumber===4?25:24,'kid-friendly':10,'date-night':batchNumber===4?4:5,dessert:5}:mode==='pilot'?{'general-dinner':3,'kid-friendly':0,'date-night':0,dessert:0}:FULL_ALLOCATION;
 const comparisonReferences=[...baseline];
 if(isBatch){
  comparisonReferences.push(...asRecipes(readJSON(path.join(staging,'recipes-322-324.json'))));
  for(let sibling=1;sibling<=4;sibling++){
   const file=path.join(staging,`batches/batch-${sibling}.recipes.json`);
   if(sibling!==batchNumber&&fs.existsSync(file))comparisonReferences.push(...asRecipes(readJSON(file)));
  }
  warnings.push('Authoring batch check only: passing this mode does not verify the complete 500-recipe catalogue. Full mode remains mandatory.');
 }
 const actualAllocation=Object.fromEntries(Object.keys(FULL_ALLOCATION).map(group=>[group,0]));
 for(const recipe of additions){
  if(check(Object.hasOwn(actualAllocation,recipe.expansionGroup),`invalid or missing expansionGroup: ${recipe.id}`))actualAllocation[recipe.expansionGroup]++;
 }
 for(const [group,count] of Object.entries(expectedAllocation))check(actualAllocation[group]===count,`${mode} allocation requires ${count} ${group} recipes; got ${actualAllocation[group]}`);
 check(baseline.length===321,'authoritative baseline must contain exactly 321 recipes');
 check(additions.length===expected,`${mode} mode requires exactly ${expected} additions; got ${additions.length}`);
 check(total===(isBatch?365:mode==='pilot'?324:500),'combined catalogue count is incorrect');
 const all=[...baseline,...additions],ids=new Set(),titles=new Set(),images=new Set();
 const planningContext={};planningContext.globalThis=planningContext;planningContext.window=planningContext;vm.runInNewContext(fs.readFileSync(path.join(ROOT,'bb-recipe-planning.js'),'utf8'),planningContext);
 const planning=planningContext.BBRecipePlanning;
 check(all.every(r=>{const m=planning.metadata(r);return typeof m.primaryProtein==='string'&&m.primaryProtein.length>0&&typeof m.cheeseHeavy==='boolean';}),'every existing and staged recipe needs derived protein and cheese metadata');
 for(const r of all){
  check(typeof r.id==='string'&&slugPattern.test(r.id),`invalid slug ID: ${r.id}`);
  check(!ids.has(r.id),`duplicate ID: ${r.id}`);ids.add(r.id);
  const title=String(r.name||'').trim().toLowerCase();check(title&&!titles.has(title),`duplicate or empty title: ${r.name}`);titles.add(title);
  if(r.slug!==undefined)check(r.slug===r.id,`separate slug must agree with stable ID: ${r.id}`);
  check(typeof r.image==='string'&&!images.has(r.image),`duplicate or invalid image path: ${r.id}`);images.add(r.image);
 }
 const normalMap=new Map(normalized.map(r=>[r.id,r]));
 check(normalMap.size===additions.length&&normalized.length===additions.length,'normalized records must map one-to-one to additions');
 const fingerprintIndex=new Map(all.map(r=>[r.id,{primaryProtein:protein(r),base:base(r),flavorProfile:flavor(r),cookingMethod:method(r),vessel:vessel(r)}]));
 check(fingerprintIndex.size===all.length&&[...fingerprintIndex.values()].every(f=>Object.values(f).every(v=>typeof v==='string'&&v)),'complete inferred culinary fingerprint index required');
 const legacyGroups=new Map();
 for(const r of baseline){const fp=inferredFingerprint(r);if(!legacyGroups.has(fp))legacyGroups.set(fp,[]);legacyGroups.get(fp).push(r.id);}
 const overlaps=[],maxima={title:0,ingredientFlavor:0};let comparisons=0;
 const declared=new Set();
 for(let n=0;n<additions.length;n++){
  const r=additions[n],f=fingerprintObject(r);
  check(r.catalogueNumber===(isBatch?batchStart:322)+n,`catalogueNumber must be ${(isBatch?batchStart:322)+n}: ${r.id}`);
  check(typeof r.primaryProtein==='string'&&r.primaryProtein.length>0,`missing primaryProtein: ${r.id}`);
  check(f&&normalizeProtein(f.primaryProtein)===normalizeProtein(r.primaryProtein),`declared protein does not agree with recipe metadata: ${r.id}`);
  check(typeof r.cheeseHeavy==='boolean',`missing cheeseHeavy: ${r.id}`);
  const dessert=r.expansionGroup==='dessert';
  const categoryTag=`${r.category||''} ${r.tag||''}`.toLowerCase();
  if(dessert){
   check(r.dinnerEligible===false&&planning.isDinner(r)===false,`dessert must be excluded from dinner autofill: ${r.id}`);
   check(/dessert|pudding|sweet baking|\bbaking\b/.test(categoryTag),`dessert allocation needs a dessert/baking category or tag: ${r.id}`);
  }else{
   check(r.dinnerEligible===true&&planning.isDinner(r),`new dinner addition must explicitly be dinner eligible: ${r.id}`);
   check(! /dessert|sweet baking|\bcake\b|\bcookies?\b/.test(categoryTag),`sweet/non-dinner recipe in a dinner allocation: ${r.id}`);
  }
  if(r.expansionGroup==='kid-friendly')check(r.kidFriendly===true,`kid-friendly allocation needs kidFriendly:true: ${r.id}`);
  if(r.expansionGroup==='date-night'){
   check(r.dateNightSpecial===true,`date-night allocation needs dateNightSpecial:true: ${r.id}`);
   check(/date[\s-]*nights?/.test(categoryTag),`date-night allocation needs a Date Night(s) category or tag: ${r.id}`);
  }else check(r.dateNightSpecial!==true,`dateNightSpecial:true belongs in the exclusive date-night allocation: ${r.id}`);
  check(f&&typeof f==='object'&&['primaryProtein','base','flavorProfile','cookingMethod','vessel'].every(k=>typeof f[k]==='string'&&f[k]),`incomplete explicit culinary fingerprint: ${r.id}`);
  if(r.fingerprint&&r.culinaryFingerprint)check(JSON.stringify(r.fingerprint)===JSON.stringify(r.culinaryFingerprint),`conflicting explicit fingerprint metadata: ${r.id}`);
  const df=declaredFingerprint(r);check(df&&!declared.has(df),`duplicate declared new fingerprint: ${r.id}`);declared.add(df);
  check(Number.isFinite(r.servings)&&r.servings>0,`invalid serving count: ${r.id}`);
  check(r.baseServings===r.servings,`base serving count differs from source: ${r.id}`);
  check(Number.isFinite(r.mins)&&r.mins>0,`invalid total cooking time: ${r.id}`);
  if(Number.isFinite(r.prep_mins)&&Number.isFinite(r.cook_mins))check(r.mins>=r.prep_mins+r.cook_mins,`total time below prep plus cook: ${r.id}`);
  check(Array.isArray(r.method)&&r.method.length>=3,`missing cooking method: ${r.id}`);
  check(Array.isArray(r.steps)&&JSON.stringify(r.steps)===JSON.stringify(r.method),`Cook steps must agree with method: ${r.id}`);
  check(r.accessTier==='premium',`new additions must remain Premium: ${r.id}`);
  check(Array.isArray(r.ingredients)&&r.ingredients.length>=3,`ingredient list missing or too short: ${r.id}`);
  check(Array.isArray(r.ingredient_display_lines)&&r.ingredient_display_lines.length===r.ingredients?.length,`Cook ingredient display lines missing: ${r.id}`);
  for(const [index,ingredient]of (r.ingredients||[]).entries()){
   check(Array.isArray(ingredient)&&ingredient.length>=4&&typeof ingredient[0]==='string'&&ingredient[0]&&typeof ingredient[1]==='string'&&ingredient[1]&&Number.isFinite(ingredient[2])&&ingredient[2]>=0&&typeof ingredient[3]==='string',`invalid source ingredient schema ${r.id}/${index}`);
   check(r.ingredient_display_lines?.[index]===`${ingredient[0]} — ${ingredient[1]}`,`Cook ingredient display line differs from source ${r.id}/${index}`);
  }
  check(r.image===`release-assets/basketboss-v17/images/new/${r.id}.webp`,`new image path does not match slug convention: ${r.id}`);
  const nr=normalMap.get(r.id);check(nr&&Array.isArray(nr.ingredients)&&nr.ingredients.length===r.ingredients?.length,`missing or mismatched normalized ingredients: ${r.id}`);
  if(nr){
   check(nr.servings===r.servings,`normalized serving count differs from source: ${r.id}`);
   for(const [index,ingredient]of (nr.ingredients||[]).entries()){
    check(fold(ingredient.name)===fold(r.ingredients?.[index]?.[0]),`normalized ingredient name/order differs from source ${r.id}/${index}`);
    if(ingredient.ingredient_index!==undefined)check(ingredient.ingredient_index===index,`normalized ingredient index is stale ${r.id}/${index}`);
    if(ingredient.recipe_id!==undefined)check(ingredient.recipe_id===r.id,`normalized ingredient recipe ID is stale ${r.id}/${index}`);
   }
  }
  for(const other of [...comparisonReferences,...additions.slice(0,n)]){
   const ts=similarity(tokens(r.name),tokens(other.name)),cs=similarity(coreFlavorTokens(r),coreFlavorTokens(other));comparisons++;
   maxima.title=Math.max(maxima.title,ts);maxima.ingredientFlavor=Math.max(maxima.ingredientFlavor,cs);
   if(ts>THRESHOLD||cs>THRESHOLD||inferredFingerprint(r)===inferredFingerprint(other))overlaps.push({candidate:r.id,other:other.id,title:round(ts),ingredientFlavor:round(cs),fingerprintMatch:inferredFingerprint(r)===inferredFingerprint(other)});
  }
 }
 check(overlaps.length===0,`new recipe similarity/fingerprint gate rejected ${overlaps.length} pair(s)`);
 const imageChecks=[],hashes=new Map(),briefChecks=[],naturalnessChecks=[];
 const naturalnessFile=path.resolve(option('--naturalness-review',path.join(staging,'image-naturalness-review.json')));
 const briefsInput=fs.readFileSync(briefsFile);sourceHashes.imageBriefs=crypto.createHash('sha256').update(briefsInput).digest('hex');
 const briefs=asRecipes(JSON.parse(briefsInput));
 if(!Array.isArray(briefs))throw Error('image briefs must contain an array or {recipes:[]}');
 const briefMap=new Map(briefs.map(b=>[b.id,b]));
 check(briefMap.size===additions.length&&briefs.length===additions.length,'image briefs must map one-to-one to additions');
 for(const r of additions){
  const b=briefMap.get(r.id);
  if(!check(Boolean(b),`missing image brief: ${r.id}`))continue;
  check(b.catalogueNumber===r.catalogueNumber&&b.image===r.image,`image brief recipe identity mismatch: ${r.id}`);
  check(b.width===1448&&b.height===1086&&b.format==='webp',`image brief must specify 1448×1086 WebP: ${r.id}`);
  check(typeof b.vessel==='string'&&b.vessel.length>0,`image brief vessel missing: ${r.id}`);
  const prompt=String(b.prompt||[b.houseComposition,b.cameraPrompt].filter(Boolean).join(' '));
  check(prompt.length>=200&&/natural daylight/i.test(prompt)&&/50mm/i.test(prompt),`image brief photography prompt incomplete: ${r.id}`);
  const negatives=(b.negativeConstraints||[]).join(' ')+' '+prompt;
  check(/no hands/i.test(negatives)&&/no (?:text|watermarks?)/i.test(negatives)&&/CGI/i.test(negatives),`image brief negative constraints incomplete: ${r.id}`);
  const ledger=b.exactIngredientLedger||b.ingredientSpecification;
  if(ledger)for(const [name]of r.ingredients||[])check(fold(ledger).includes(fold(name)),`image ingredient ledger omits ${name}: ${r.id}`);
  if(b.recipeMethod)check(JSON.stringify(b.recipeMethod)===JSON.stringify(r.method),`image brief method is stale: ${r.id}`);
  briefChecks.push({id:r.id,catalogueNumber:r.catalogueNumber,stylingVersion:b.stylingVersion||'pilot'});
 }
 if(!contentOnly){
  let naturalnessRows=[];
  if(fs.existsSync(naturalnessFile)){
   const review=readJSON(naturalnessFile);
   check(review.schemaVersion===1&&Array.isArray(review.images),'naturalness review must contain schemaVersion:1 and images:[]');
   naturalnessRows=Array.isArray(review.images)?review.images:[];
  }else check(false,`naturalness review is required before final image verification: ${naturalnessFile}`);
  const naturalnessMap=new Map(naturalnessRows.map(r=>[r.id,r]));
  check(naturalnessMap.size===naturalnessRows.length,'duplicate recipe IDs in naturalness review');
  for(const r of all){
   const imagePath=path.resolve(ROOT,r.image||'');
   if(!check(imagePath.startsWith(ROOT+path.sep)&&fs.existsSync(imagePath),`missing or escaping image file: ${r.id}`))continue;
   try{
    const buffer=fs.readFileSync(imagePath),dims=webpDimensions(buffer),hash=crypto.createHash('sha256').update(buffer).digest('hex');
    check(path.extname(imagePath)==='.webp',`wrong image extension: ${r.id}`);
    check(!hashes.has(hash),`identical image contents: ${r.id} and ${hashes.get(hash)}`);hashes.set(hash,r.id);
    const newImage=additions.includes(r)||r.id==='family-crispy-oven-chicken-goujons';
    if(newImage){
     check(dims.width===1448&&dims.height===1086,`image must be 1448×1086: ${r.id} is ${dims.width}×${dims.height}`);
     const review=naturalnessMap.get(r.id);
     const passed=review?.naturalnessReview==='passed'&&review.image===r.image&&review.sha256===hash&&typeof review.reviewedAt==='string'&&Number.isFinite(Date.parse(review.reviewedAt));
     check(passed,`naturalness review missing, pending or stale for current image: ${r.id}`);
     naturalnessChecks.push({id:r.id,passed:Boolean(passed),sha256:hash});
    }
    imageChecks.push({id:r.id,...dims,sha256:hash,isNewStandard:newImage});
   }catch(e){failures.push(`invalid image ${r.id}: ${e.message}`);}
  }
 }else warnings.push('Content-only run: image existence, uniqueness and export dimensions have not been validated.');
 const context={console};context.globalThis=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ROOT,'basketboss-aisles-v20.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(ROOT,'basketboss-pricing-v19.js'),'utf8'),context);
 const pricing=context.BBPriceV19;
 if(typeof pricing.estimateMeal!=='function')throw Error('BBPriceV19.estimateMeal is required; pantry pricing implementation is missing');
 const priceReports=[],legacyPricingIssues=[];
 for(const r of all){
  const isNew=additions.includes(r),nr=isNew?normalMap.get(r.id):legacyNormalized.find(x=>x.id===r.id);
  if(!nr){(isNew?failures:legacyPricingIssues).push(`missing normalized record: ${r.id}`);continue;}
  const byMarket={};
  if(isNew)for(const i of nr.ingredients||[]){
   check(typeof i.key==='string'&&Number.isFinite(i.quantity)&&i.quantity>0&&typeof i.unit==='string',`invalid normalized ingredient ${r.id}: ${i.key||i.name}`);
   const converted=pricing.normalizeUnit(i.key,i.quantity,i.unit);
   check(converted&&pricing.catalog[`${pricing.canonical(i.key)}|${converted.unit}`],`new ingredient lacks exact canonical pack mapping ${r.id}: ${i.key}|${i.unit}`);
  }
  for(const market of MARKETS){
   const estimate=pricing.estimateMeal({ingredients:nr.ingredients,market});
   const valid=estimate&&Number.isFinite(estimate.amount)&&estimate.amount>=0&&estimate.pending===0;
   if(!valid){const issue=`${r.id}/${market}: ${estimate?.pending??'?'} unresolved ingredient quote(s)`;if(isNew||mode==='full')failures.push(issue);else legacyPricingIssues.push(issue);}
   if(estimate)for(const line of estimate.lines||[]){
    const q=line.quote;
    if(q&&typeof q.amount==='number')check(Number.isFinite(q.amount)&&q.amount>=0,`NaN/negative line quote ${r.id}/${market}/${line.key}`);
    if(isNew&&q&&Number.isFinite(q.unroundedMealAmount)&&Number.isFinite(q.packAmount)){
     if(!pricing.isPantryStaple(line.key))check(Math.abs(q.unroundedMealAmount-q.packAmount)<.000001,`fresh ingredient is not full-pack rounded: ${r.id}/${line.key}/${market}`);
     else if(Number.isFinite(q.unitPrice)){const amount=pricing.normalizeUnit(line.key,line.quantity,line.unit);if(amount&&amount.unit===q.packUnit)check(Math.abs(q.unroundedMealAmount-amount.quantity*q.unitPrice)<.000001,`staple is not exact pro-rata: ${r.id}/${line.key}/${market}`);}
    }
   }
   if(isNew){
    const stored=r.ci_estimates?.[market];
    if(market==='UK')check(Number.isFinite(r.cost)&&Math.abs(r.cost-estimate.amount)<.005,`legacy recipe cost differs from runtime UK estimate: ${r.id}`);
    check(stored&&Number.isFinite(stored.estimate)&&Math.abs(stored.estimate-estimate.amount)<.005,`stored regional estimate differs from runtime ${r.id}/${market}`);
    check(stored?.currency===(market==='US'?'USD':'GBP'),`stored regional currency is incorrect ${r.id}/${market}`);
    byMarket[market]={amount:estimate?.amount??null,perServing:valid?round(estimate.amount/r.servings):null,currency:estimate?.currency,knownAmount:estimate?.knownAmount,pending:estimate?.pending,lines:estimate?.lines};
   }
  }
  if(isNew)priceReports.push({id:r.id,name:r.name,servings:r.servings,markets:byMarket});
 }
 if(legacyPricingIssues.length)warnings.push(`${legacyPricingIssues.length} legacy recipe/market estimates remain incomplete. Pilot estimates are strict; full mode rejects unresolved legacy estimates.`);
 warnings.push('Automated uniqueness gates do not certify culinary originality or ingredient-level visual accuracy; visual and culinary review remain required.');
 warnings.push('Regional prices retain the existing illustrative category multipliers; these are not verified retailer shelf quotes.');
 const report={schemaVersion:1,mode,sourceHashes,batch:isBatch?batchNumber:null,comparisonReferences:comparisonReferences.length,imageBriefs:{validated:briefChecks.length,file:briefsFile},contentOnly,status:failures.length?'failed':contentOnly?'content-checks-passed':'automated-checks-passed',baselineCommit:BASELINE,counts:{baseline:baseline.length,additions:additions.length,total,premium:total-100,targetTotal:500,targetPremium:400},allocation:{expected:expectedAllocation,actual:actualAllocation,dinnerAdditions:actualAllocation['general-dinner']+actualAllocation['kid-friendly']+actualAllocation['date-night'],dessertAdditions:actualAllocation.dessert},legacyOverrides:legacy.applied,metadata:{derivedRecords:all.length,completeFingerprintRecords:fingerprintIndex.size,dinnerEligible:all.filter(r=>planning.isDinner(r)).length},similarity:{metric:'Jaccard normalized title tokens and primary ingredient/flavor tokens; independent derived fingerprint',threshold:THRESHOLD,comparisons,maxTitleSimilarity:round(maxima.title),maxIngredientFlavorSimilarity:round(maxima.ingredientFlavor),rejectedPairs:overlaps,legacyFingerprintCollisionGroups:[...legacyGroups.values()].filter(g=>g.length>1).length},images:{validated:imageChecks.length,naturalnessReview:{file:naturalnessFile,required:!contentOnly,checked:naturalnessChecks.length,passed:naturalnessChecks.filter(r=>r.passed).length},newStandard:imageChecks.filter(x=>x.isNewStandard)},prices:priceReports,legacyPricingIssues,warnings,failures};
 const reportPath=option('--report',null);
 if(reportPath){const out=path.resolve(reportPath);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({...report,images:{...report.images,newStandard:report.images.newStandard.map(({sha256,...rest})=>rest)},prices:report.prices.map(({id,name,servings,markets})=>({id,name,servings,markets:Object.fromEntries(Object.entries(markets).map(([market,value])=>[market,{amount:value.amount,perServing:value.perServing,currency:value.currency,pending:value.pending}]))}))},null,2));
 if(failures.length)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
