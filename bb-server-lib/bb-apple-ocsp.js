/* Pinned Apple SDK 3.1.0 compatibility: its parseX509Date() regex omits the
 * trailing Z in ASN.1 GeneralizedTime. Invalid Date would bypass comparisons.
 * Keep the SDK's existing signatures, certificate checks, OCSP status and
 * MAX_SKEW comparisons; supply a strict, calendar-validated UTC Date only.
 */
export function parseAppleOCSPUTCDate(value){
 const match=typeof value==='string'?/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(?:\.(\d{1,9}))?Z?$/.exec(value):null;
 const invalid=()=>{throw new RangeError('Invalid Apple OCSP UTC date.');};
 if(!match)return invalid();
 const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number),millisecond=Number((match[7]||'').padEnd(3,'0').slice(0,3));
 if(year<1||month<1||month>12||day<1||day>31||hour>23||minute>59||second>59)return invalid();
 const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,millisecond);
 if(!Number.isFinite(date.getTime())||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day||date.getUTCHours()!==hour||date.getUTCMinutes()!==minute||date.getUTCSeconds()!==second)return invalid();
 return date;
}
export function withAppleOCSPDateCompatibility(verifier,sdk){
 if(typeof verifier?.parseX509Date!=='function'||typeof sdk?.VerificationException!=='function'||!Number.isInteger(sdk?.VerificationStatus?.FAILURE))throw Error('Pinned Apple verifier date interface is unavailable.');
 Object.defineProperty(verifier,'parseX509Date',{value(value){
  try{return parseAppleOCSPUTCDate(value);}catch{throw new sdk.VerificationException(sdk.VerificationStatus.FAILURE);}
 }});
 return verifier;
}
