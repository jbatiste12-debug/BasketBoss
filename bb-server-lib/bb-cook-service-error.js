/* Diagnostic codes are fixed server-owned categories. Never retain or return
 * provider bodies, error messages, credentials, recipe data or conversations. */
const CODES=new Set([
 'BB_COOK_PROVIDER_ACCESS','BB_COOK_PROVIDER_LIMIT',
 'BB_COOK_PROVIDER_UNAVAILABLE','BB_COOK_PROVIDER_RESPONSE',
 'BB_COOK_PROVIDER_REJECTED','BB_COOK_SERVICE_FAILURE'
]);
class CookServiceError extends Error{
 constructor(code){super(CODES.has(code)?code:'BB_COOK_SERVICE_FAILURE');this.code=this.message;}
}
export const cookServiceError=code=>new CookServiceError(code);
export const cookServiceCode=error=>error instanceof CookServiceError&&CODES.has(error.code)?error.code:'BB_COOK_SERVICE_FAILURE';
export function cookProviderError(status){
 return cookServiceError(status===401||status===403?'BB_COOK_PROVIDER_ACCESS':status===429?'BB_COOK_PROVIDER_LIMIT':status>=500&&status<=599?'BB_COOK_PROVIDER_UNAVAILABLE':'BB_COOK_PROVIDER_REJECTED');
}
