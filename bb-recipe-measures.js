/* BasketBoss recipe presentation only. Never use these rounded strings for
   serving arithmetic, pantry balances, prices, or shopping reconciliation.
   BasketBoss kitchen volume: 1 cup = 8 fl oz = 240 ml.
   Ingredient-specific approximate cup weights: King Arthur Baking's chart
   https://www.kingarthurbaking.com/learn/ingredient-weight-chart
   Flour 120 g/cup; granulated sugar 198; caster sugar 190; butter 226;
   old-fashioned/quick oats 89; steel-cut oats 140. Match the named form only.
*/
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BBRecipeMeasures=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const CUP_ML=240,OUNCE_G=28.35,POUND_G=453.6;
  const FRACTIONS=Object.freeze({'¼':1/4,'½':1/2,'¾':3/4,'⅓':1/3,'⅔':2/3,'⅛':1/8,'⅜':3/8,'⅝':5/8,'⅞':7/8});
  const NUMBER='(?:\\d+\\/\\d+|(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+)?[¼½¾⅓⅔⅛⅜⅝⅞]?|[¼½¾⅓⅔⅛⅜⅝⅞])';
  const AMOUNTS=new RegExp('(^|[^\\w./-])('+NUMBER+')(?:\\s*(?:–|—|-|to)\\s*('+NUMBER+'))?\\s*(kilograms?|kg|grams?|g|millilitres?|milliliters?|ml|litres?|liters?|l)\\b','gi');
  const TEMPERATURES=new RegExp('(^|[^\\w./-])(-?\\d+(?:\\.\\d+)?)(?:\\s*(?:–|—|-|to)\\s*(-?\\d+(?:\\.\\d+)?))?\\s*(°\\s*C\\b|degrees?\\s+Celsius\\b|C\\b)','gi');
  const us=market=>market==='US'||market==='UnitedStates';
  const original=value=>String(value??'');
  const decimal=value=>value>0&&value<.01?'<0.01':Number(value.toFixed(2)).toString();
  function number(value){
    let s=String(value).replaceAll(',','').trim(),tail=s.slice(-1),fraction=FRACTIONS[tail]||0;
    if(fraction)s=s.slice(0,-1).trim();
    if(!s)return fraction;
    const parts=s.split(/\s+/);let total=fraction;
    for(const part of parts){const pair=part.split('/'),n=pair.length===2?Number(pair[0])/Number(pair[1]):Number(part);if(!Number.isFinite(n))return NaN;total+=n;}
    return total;
  }
  function familiar(value){
    const whole=Math.floor(value),rest=value-whole;
    // Only use a familiar fraction if its error is at most 1%; metric source
    // remains alongside the display for precise weighing/measuring.
    for(const [fraction,part] of Object.entries({'':0,'¼':1/4,'⅓':1/3,'½':1/2,'⅔':2/3,'¾':3/4,'1':1})){
      if(whole+part>0&&Math.abs(whole+part-value)<=value*.01){
        if(fraction==='1')return String(whole+1);
        return (whole?String(whole):'')+(whole&&fraction?' ':'')+fraction;
      }
    }
    return decimal(value);
  }
  function density(name){
    const shared=typeof window!=='undefined'&&window.BBPantryPolicy?.cupGrams(name);if(shared)return shared.grams;
    const n=original(name).toLowerCase().replace(/[‐‑–—-]/g,' ').replace(/\s+/g,' ').trim();
    // Anchoring avoids confusing flour with flour tortillas, butter with
    // peanut butter, or dry oats with prepared porridge / oat milk.
    if(/^(?:(?:organic|unbleached) )?(?:plain|all purpose) flour(?:,? (?:sifted|for dusting))?$/.test(n))return 120;
    if(/^(?:white )?granulated (?:white )?sugar$/.test(n))return 198;
    if(/^(?:caster|castor|superfine) sugar$/.test(n))return 190;
    if(/^(?:(?:salted|unsalted|softened) )?butter(?:,? (?:softened|melted|at room temperature))?$/.test(n))return 226;
    if(/^(?:old fashioned|quick cooking|quick) oats$/.test(n))return 89;
    if(/^steel cut oats$/.test(n))return 140;
    return null;
  }
  function weight(grams,cupWeight){
    if(cupWeight){const amount=grams/cupWeight;return familiar(amount)+' US '+(amount<=1.01?'cup':'cups');}
    const pounds=grams>=POUND_G;
    return decimal(grams/(pounds?POUND_G:OUNCE_G))+(pounds?' lb':' oz');
  }
  function volume(ml){
    // Configured kitchen factors; rounded displays remain approximate.
    if(ml>=CUP_ML/4){
      const amount=ml/CUP_ML,display=familiar(amount);
      // Liquid measuring jugs also carry fl oz; avoid an awkward decimal
      // fraction of a cup for smaller amounts without a familiar cup mark.
      if(amount<1&&display.includes('.'))return decimal(ml/(CUP_ML/8))+' US fl oz';
      return display+' US '+(amount<=1.01?'cup':'cups');
    }
    if(ml>=CUP_ML/16)return familiar(ml/(CUP_ML/16))+' tbsp';
    return familiar(ml/(CUP_ML/48))+' tsp';
  }
  function amounts(text,name){
    const cupWeight=density(name);
    return text.replace(AMOUNTS,(all,prefix,first,last,unit,offset)=>{
      const a=number(first),b=last?number(last):null;
      if(!(a>0)||!Number.isFinite(a)||(last&&(!(b>0)||!Number.isFinite(b))))return all;
      const normalized=unit.toLowerCase(),liquid=/^(?:ml|millilit|l$|lit)/.test(normalized);
      const multiplier=/^(?:kg|kilogram|l$|lit)/.test(normalized)?1000:1;
      // A multipack's printed pack weight is not a scoop quantity.
      const packed=/(?:\d|[¼½¾])\s*[x×]\s*$/i.test(text.slice(0,offset+prefix.length));
      const convert=n=>liquid?volume(n*multiplier):weight(n*multiplier,packed?null:cupWeight);
      const converted=convert(a)+(last?'–'+convert(b):'');
      return prefix+'≈ '+converted+' ('+all.slice(prefix.length)+')';
    });
  }
  function temperatures(text){
    return text.replace(TEMPERATURES,(all,prefix,first,last,unit)=>{
      // Lower-case "c" can mean cups. Only recognise bare C/c at plausible
      // oven / food-safety temperatures; explicit °C/Celsius is unambiguous.
      if(/^c$/i.test(unit)&&Number(first)>0&&Number(first)<40)return all;
      const convert=n=>decimal(Number(n)*9/5+32);
      return prefix+convert(first)+(last?'–'+convert(last):'')+'°F ('+all.slice(prefix.length)+')';
    });
  }
  function quantity(text,name,market){const value=original(text);return us(market)?amounts(value,name):value;}
  // Instruction quantities keep their exact metric source, and use weight
  // rather than guessed ingredient density when the ingredient is ambiguous.
  function step(text,market){const value=original(text);return us(market)?temperatures(amounts(value,'')):value;}
  return Object.freeze({quantity,step});
});
