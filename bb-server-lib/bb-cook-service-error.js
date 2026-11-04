/* Diagnostic codes are fixed server-owned categories. Never retain or return
 * provider bodies, error messages, credentials, recipe data or conversations. */
const CODES=new Set([
 'BB_COOK_PROVIDER_ACCESS','BB_COOK_PROVIDER_LIMIT',
 'BB_COOK_PROVIDER_UNAVAILABLE','BB_COOK_PROVIDER_RESPONSE',
 'BB_COOK_PROVIDER_REJECTED','BB_COOK_SERVICE_FAILURE',
 'BB_COOK_SERVICE_UNAVAILABLE','BB_COOK_DAILY_LIMIT',
 'BB_COOK_AUTH_REQUIRED','BB_COOK_PREMIUM_REQUIRED',
 'BB_COOK_ACCOUNT_PENDING','BB_COOK_ACCOUNT_UNAVAILABLE','BB_COOK_MEMBERSHIP_UNAVAILABLE',
 'BB_COOK_SESSION_MISCONFIGURED','BB_COOK_SESSION_REPLACED','BB_COOK_SESSION_UNAVAILABLE',
 'BB_COOK_CONFIG_AI_DISABLED','BB_COOK_CONFIG_TTS_DISABLED','BB_COOK_CONFIG_BINDINGS_UNAVAILABLE',
 'BB_COOK_CONFIG_LIMITS_UNAVAILABLE','BB_COOK_CONFIG_PROVIDER_UNAVAILABLE',
 'BB_COOK_ORIGIN_REJECTED','BB_COOK_REQUEST_INVALID','BB_COOK_REQUEST_CANCELLED','BB_COOK_METHOD_REJECTED'
]);
const STAGES=new Set(['config','authorization','request','quota_database','quota','provider_request','provider_audio','account_state','session_config','session_verification']);
// Deliberately take primitive, allowlisted categories only. Never accept an
// Error, Request, account identifier or provider payload as logging context.
export function logCookDiagnostic(stage,code,status){
 if(!STAGES.has(stage)||!CODES.has(code)||!Number.isInteger(status)||status<400||status>599)return false;
 try{console.warn('BB_COOK_DIAGNOSTIC '+JSON.stringify({stage,code,status}));}catch{}
 return true;
}
export const cookAuthorizationCode=status=>status===401?'BB_COOK_AUTH_REQUIRED':status===403?'BB_COOK_PREMIUM_REQUIRED':status===409?'BB_COOK_ACCOUNT_PENDING':'BB_COOK_MEMBERSHIP_UNAVAILABLE';
class CookServiceError extends Error{
 constructor(code){super(CODES.has(code)?code:'BB_COOK_SERVICE_FAILURE');this.code=this.message;}
}
export const cookServiceError=code=>new CookServiceError(code);
export const cookServiceCode=error=>error instanceof CookServiceError&&CODES.has(error.code)?error.code:'BB_COOK_SERVICE_FAILURE';
export function cookProviderError(status){
 return cookServiceError(status===401||status===403?'BB_COOK_PROVIDER_ACCESS':status===429?'BB_COOK_PROVIDER_LIMIT':status>=500&&status<=599?'BB_COOK_PROVIDER_UNAVAILABLE':'BB_COOK_PROVIDER_REJECTED');
}
