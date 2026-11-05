/* Typical reduction windows supplied for BasketBoss, never retailer guarantees.
   Store IDs are shared by the public sightings API and the client. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BBYellowStickers=api;})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const TTL=90*60*1000,TIME_ZONE='Europe/London';
 const LABELS=Object.freeze({waitrose:'Waitrose & Partners','ci-coop':'Channel Islands Co-op','marks-spencer':'M&S Food',alliance:'Alliance','morrisons-daily':'Morrisons Daily / SandpiperCI',iceland:'Iceland',tesco:'Tesco',sainsburys:'Sainsbury’s',asda:'Asda',morrisons:'Morrisons',aldi:'Aldi',lidl:'Lidl'});
 const REGIONS=Object.freeze({UK:Object.freeze(['waitrose','marks-spencer','iceland','tesco','sainsburys','asda','morrisons','aldi','lidl']),Guernsey:Object.freeze(['waitrose','ci-coop','marks-spencer','alliance','morrisons-daily','iceland']),Jersey:Object.freeze(['waitrose','ci-coop','marks-spencer','alliance','morrisons-daily','iceland'])});
 const windowRow=(label,start,end)=>Object.freeze({label,start,end});
 const TABLE=Object.freeze({
  waitrose:Object.freeze([windowRow('First reductions','10:00','11:30'),windowRow('Final reductions','17:30','18:30')]),
  'ci-coop':Object.freeze([windowRow('Early markdowns','08:30','09:30'),windowRow('Final reductions','17:00','18:30')]),
  'marks-spencer':Object.freeze([windowRow('First reductions','12:30','13:30'),windowRow('Final reductions','16:30','17:30')]),
  alliance:Object.freeze([windowRow('Morning markdowns','09:00','10:30'),windowRow('Afternoon reductions','16:00','17:30')]),
  'morrisons-daily':Object.freeze([windowRow('Final reductions','17:00','18:30')]),
  iceland:Object.freeze([windowRow('Morning markdowns','09:00','10:30'),windowRow('Evening reductions','17:00','18:00')]),
  major:Object.freeze([windowRow('First reductions','08:00','10:00'),windowRow('Afternoon reductions','13:00','15:00'),windowRow('Final clearance','18:00','19:30')]),
  discounter:Object.freeze([windowRow('Morning markdowns','07:30','08:30'),windowRow('Final reductions','16:00','17:30')])
 });
 const normalize=value=>typeof value==='string'?value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' '):'';
 function resolveStore(region,value){
  if(!Object.hasOwn(REGIONS,region)||typeof value!=='string'||value.length>160)return null;
  const n=normalize(value);let id=REGIONS[region].find(key=>normalize(key)===n);
  if(!id){
   if(/^waitrose(?: and partners)?(?: |$)/.test(n))id='waitrose';
   else if(/^(?:channel islands co ?op|ci co ?op|grand marche|locale)(?: |$)/.test(n))id='ci-coop';
   else if(/^(?:m and s|marks and spencer|marks spencer)(?: |$)/.test(n))id='marks-spencer';
   else if(/^alliance(?: |$)/.test(n))id='alliance';
   else if(/^(?:morrisons daily|sandpiperci|sandpiper ci)(?: |$)/.test(n))id='morrisons-daily';
   else if(/^iceland(?: |$)/.test(n))id='iceland';
   else if(/^sainsbury ?s(?: |$)/.test(n))id='sainsburys';
   else for(const key of ['tesco','asda','morrisons','aldi','lidl'])if(n===key||n.startsWith(key+' ')){id=key;break;}
  }
  return id&&REGIONS[region].includes(id)?Object.freeze({id,label:LABELS[id],region}):null;
 }
 function localParts(value){
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;
  const values=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(date).map(part=>[part.type,part.value]));
  return {year:Number(values.year),month:Number(values.month),day:Number(values.day),hour:Number(values.hour),minute:Number(values.minute),weekday:values.weekday};
 }
 function localEpoch(day,time){
  const [hour,minute]=time.split(':').map(Number),target=Date.UTC(day.year,day.month-1,day.day,hour,minute);let at=target;
  for(let i=0;i<3;i++){const part=localParts(at);at+=target-Date.UTC(part.year,part.month-1,part.day,part.hour,part.minute);}
  return at;
 }
 function localDate(value=Date.now()){const parts=localParts(value);return parts?[parts.year,String(parts.month).padStart(2,'0'),String(parts.day).padStart(2,'0')].join('-'):null;}
 function nextDay(parts){const value=new Date(Date.UTC(parts.year,parts.month-1,parts.day+1,12));return localParts(value);}
 function windows(region,store,date=Date.now()){
  const resolved=resolveStore(region,store),day=localParts(date);if(!resolved||!day)return [];
  let rows=TABLE[resolved.id]||TABLE[['aldi','lidl'].includes(resolved.id)?'discounter':'major'];
  if(day.weekday==='Sun'){
   if(resolved.id==='waitrose')rows=[rows[0],windowRow('Final reductions','15:00','15:45')];
   else if(region==='UK'&&['tesco','sainsburys','asda','morrisons','aldi','lidl'].includes(resolved.id))rows=[...rows.slice(0,-1),windowRow('Final clearance','14:30','15:30')];
  }
  return rows.map(row=>Object.freeze({...row,startAt:localEpoch(day,row.start),endAt:localEpoch(day,row.end),estimated:true,timeZone:TIME_ZONE,note:resolved.id==='ci-coop'&&day.weekday==='Sun'?'Sunday reductions may be earlier; check your branch.':''}));
 }
 function nextWindow({region,store,now=Date.now()}={}){
  if(!Number.isFinite(now))return null;const day=localParts(now);if(!day)return null;
  const today=windows(region,store,now),active=today.filter(row=>now>=row.startAt&&now<row.endAt).sort((a,b)=>b.startAt-a.startAt)[0],next=active||today.find(row=>now<row.startAt);
  if(next)return Object.freeze({...next,active:!!active,tomorrow:false});
  const nextDate=nextDay(day),nextNoon=localEpoch(nextDate,'12:00'),first=windows(region,store,nextNoon)[0];return first?Object.freeze({...first,active:false,tomorrow:true}):null;
 }
 function formatTime(value){const [h,m]=value.split(':').map(Number);return (h%12||12)+(m?':'+String(m).padStart(2,'0'):'')+' '+(h>=12?'pm':'am');}
 function typicalLabel(window){return window?'🏷️ Yellow stickers: '+window.label+' typically '+formatTime(window.start)+'–'+formatTime(window.end)+(window.tomorrow?' tomorrow':window.active?' · now':''):'';}
 function validTimestamp(value,now){const at=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(at)&&at<=now+30000&&at>now-TTL?at:null;}
 function sightingLabel(value,{now=Date.now(),local=false}={}){
  const at=validTimestamp(value,now);if(at===null)return '';const minutes=Math.max(0,Math.floor((now-at)/60000)),ago=minutes===0?'just now':minutes+' min'+(minutes===1?'':'s')+' ago';return (local?'On this device: Yellow stickers spotted ':'🟢 Live: Yellow stickers spotted ')+ago;
 }
 return Object.freeze({TTL,TIME_ZONE,regions:REGIONS,stores:LABELS,baselines:TABLE,resolveStore,localDate,windows,nextWindow,typicalLabel,validTimestamp,sightingLabel});
});
