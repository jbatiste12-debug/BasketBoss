/* Display only. Recipe minute totals and timer values remain unchanged. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBDuration=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function format(value){
  if((typeof value!=='number'&&typeof value!=='string')||String(value).trim()==='')return '?';
  const minutes=Number(value);
  if(!Number.isFinite(minutes)||minutes<0)return '?';
  const rounded=Math.round(minutes),hours=Math.floor(rounded/60),remainder=rounded%60;
  return [hours?hours+(hours===1?'hr':'hrs'):'',remainder||!hours?remainder+(remainder===1?'min':'mins'):''].filter(Boolean).join(' ');
 }
 const number='\\d+(?:\\.\\d+)?';
 const hour='(?:hours?|hrs?)',minute='(?:minutes?|mins?)';
 // Combined hours and minutes must be consumed before the individual units.
 const combined=new RegExp('\\b('+number+')\\s*'+hour+'\\s+(?:and\\s+)?('+number+')\\s*'+minute+'\\b','gi');
 const range=new RegExp('\\b('+number+')\\s*([–—-]|to)\\s*('+number+')\\s*('+hour+'|'+minute+')\\b','gi');
 const single=new RegExp('\\b('+number+')\\s*('+hour+'|'+minute+')\\b','gi');
 function text(value){
  return String(value??'')
   .replace(combined,(_,hours,minutes)=>format(Number(hours)*60+Number(minutes)))
   .replace(range,(_,start,separator,end,unit)=>{
    const factor=/^(?:h)/i.test(unit)?60:1;
    return format(Number(start)*factor)+(separator==='to'?' to ':'–')+format(Number(end)*factor);
   })
   .replace(single,(_,amount,unit)=>format(Number(amount)*(/^(?:h)/i.test(unit)?60:1)));
 }
 function seconds(value){
  const source=String(value??''),match=source.match(/\b(\d+(?:\.\d+)?)(?:\s*(?:[–—-]|to)\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/i);
  if(!match)return null;
  const unit=match[2].toLowerCase(),factor=unit.startsWith('h')?3600:unit.startsWith('s')?1:60;
  let total=Number(match[1])*factor;
  if(factor===3600){const remainder=source.slice(match.index+match[0].length).match(/^\s*(?:and\s+)?(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/i);if(remainder)total+=Number(remainder[1])*60;}
  return total>0&&total<=86400?Math.round(total):null;
 }
 return Object.freeze({format,text,seconds});
});
