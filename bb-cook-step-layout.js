/* View-only action lists. Recipe wording, order, quantities and safety checks
 * remain intact; speech and timer parsing continue to use the source text. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBCookStepLayout=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 function actions(value){
  const text=String(value||'').trim();if(!text)return [];
  // A sentence boundary requires whitespace and a new capital. Decimal points,
  // abbreviations and short units remain attached to their original sentence.
  const out=[];let start=0;
  for(let i=0;i<text.length;i++){
   const character=text[i],tail=text.slice(i+1),prefix=text.slice(start,i+1);
   const abbreviation=/(?:\b(?:e\.g|i\.e|Mr|Mrs|Dr|approx|min|mins|hr|hrs|tsp|tbsp)|\b[A-Z])\.$/.test(prefix)&&!(/\d\s*°?\s*[CF]\.$/.test(prefix));
   const sentence=/[.!?]/.test(character)&&/^\s+[A-Z“"(]/.test(tail)&&!abbreviation;
   const semicolon=character===';'&&/^\s+\S/.test(tail);
   if(sentence||semicolon){out.push(text.slice(start,i+1).trim());start=i+1;}
  }
  if(text.slice(start).trim())out.push(text.slice(start).trim());return out;
 }
 function render(container,value){
  if(!container)return;const doc=container.ownerDocument,list=doc.createElement('ul');list.className='bb-cook-actions';
  for(const action of actions(value)){
   const li=doc.createElement('li');
   const pattern=/\b\d+(?:[.,]\d+)?(?:\s*[–—-]\s*\d+(?:[.,]\d+)?)?\s*(?:°\s*[CF]|degrees?\s*[CF]|hours?|minutes?|seconds?|mins?|hrs?)(?:\s+\d+\s*mins?)?\b/gi;
   let position=0;for(const match of action.matchAll(pattern)){li.append(doc.createTextNode(action.slice(position,match.index)));const strong=doc.createElement('strong');strong.textContent=match[0];li.append(strong);position=match.index+match[0].length;}
   li.append(doc.createTextNode(action.slice(position)));list.append(li);
  }
  container.replaceChildren(list);container.setAttribute('data-bb-measures','');
 }
 return Object.freeze({actions,render});
});
