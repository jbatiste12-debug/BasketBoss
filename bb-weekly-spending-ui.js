/* Read-only presentation of the existing shopping and weekly purchase ledger.
   No stored totals, receipts, quantities or catalogue prices are changed. */
(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BBWeeklySpendingUI=api;
})(typeof window==='undefined'?null:window,function(){
 'use strict';
 const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER/100;
 const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
 const cents=value=>Math.round((value+Number.EPSILON)*100);
 function period(ledger,now,market){
  const empty={text:'',start:'',end:''};
  try{
   if(typeof ledger?.week!=='function')return empty;
   const key=ledger.week(now,market);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return empty;
   const first=new Date(key+'T12:00:00Z');
   if(!Number.isFinite(first.getTime())||first.toISOString().slice(0,10)!==key)return empty;
   const last=new Date(first.getTime()+6*86400000);
   const format=(date,year)=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',...(year?{year:'numeric'}:{}),timeZone:'UTC'}).format(date);
   return {text:'Calendar week: '+format(first,first.getUTCFullYear()!==last.getUTCFullYear())+' – '+format(last,true),start:key,end:last.toISOString().slice(0,10)};
  }catch{return empty;}
 }
 function view(options={}){
  const {ledger,session,archives={},context,progress={},quote}=options;
  const now=Number.isFinite(options.now)?options.now:Date.now();
  const leftToBuy=amount(options.shoppingSpend)?options.shoppingSpend:0,shoppingPending=count(options.shoppingPending);
  const baseTotal=amount(options.baseTotal)?options.baseTotal:leftToBuy,basePending=count(options.basePending);
  const money=value=>{
   try{if(typeof options.money==='function')return String(options.money(value));}catch{}
   return value.toFixed(2);
  };
  let recordedAvailable=false,recordedKnown=null,recordedPending=0;
  if(typeof ledger?.budget==='function'&&typeof context?.actor==='string'&&context.actor&&typeof context.market==='string'&&context.market)try{
   const recorded=ledger.budget({total:0,pending:0,lines:[],session,archives,context,progress,quote,now});
   if(amount(recorded?.total)&&Number.isSafeInteger(recorded.pending)&&recorded.pending>=0){
    recordedAvailable=true;recordedKnown=recorded.total;recordedPending=recorded.pending;
   }
  }catch{}
  const combinedTotal=recordedAvailable?(cents(recordedKnown)+cents(leftToBuy))/100:baseTotal;
  const combinedPending=recordedAvailable?recordedPending+shoppingPending:basePending;
  const dates=period(ledger,now,context?.market);
  return Object.freeze({
   leftToBuy,leftToBuyText:money(leftToBuy),
   leftToBuyNote:shoppingPending?shoppingPending+' item '+(shoppingPending===1?'price needs':'prices need')+' checking.':'Estimated from your current shopping list. Actual checkout prices may vary.',
   recordedAvailable,recordedKnown,recordedPending,
   recordedText:recordedAvailable?money(recordedKnown):'Unavailable',
   recordedNote:recordedAvailable?(recordedPending?'Some purchase prices need checking. Recorded costs can include estimates.':'Recorded costs can include estimates.'):'The saved purchase breakdown could not be checked. Your existing weekly estimate is shown below.',
   combinedTotal,combinedPending,
   combinedLabel:recordedAvailable?'Recorded purchases + shopping estimate':'Existing weekly estimate',
   combinedText:money(combinedTotal),
   combinedNote:combinedPending?'Some prices still need checking.':'',
   periodText:dates.text,weekStart:dates.start,weekEnd:dates.end,
  });
 }
 return Object.freeze({view});
});
