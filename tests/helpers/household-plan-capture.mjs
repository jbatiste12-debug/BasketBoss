export function householdPlanCaptureSource(html){
 const start=html.indexOf('function bbCaptureSharedPlanEdit(before){');
 const end=html.indexOf('function notify(msg){',start);
 if(start<0||end<=start)throw Error('Shared plan edit bridge is missing.');
 return html.slice(start,end)+'\n';
}
