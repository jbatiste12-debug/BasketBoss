// A hosted simulator can finish launching while simctl's handshake times out.
// Only isolated CI may recover, and only a complete app report can replace a
// failed handshake. A real failed report is returned unchanged for the caller
// to fail; no recipe/UI assertion is bypassed.
export function launchCookSmoke({ci=false,launch,readReport,terminate,confirmBoot}){
 const complete=()=>{const report=readReport();return report?.complete===true?report:null;};
 try{launch();return {report:null};}
 catch(error){
  if(!ci||error?.code!=='ETIMEDOUT')throw error;
  let report=complete();
  if(report)return {report};
  terminate();
  // Preserve a failure that finished between the first read and termination.
  report=complete();
  if(report)return {report};
  confirmBoot();
  try{launch();return {report:null};}
  catch(retryError){
   if(retryError?.code==='ETIMEDOUT'){
    report=complete();
    if(report)return {report};
   }
   throw retryError;
  }
 }
}
