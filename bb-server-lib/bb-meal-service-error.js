/* Fixed diagnostic categories only. Never log or return provider bodies,
 * exceptions, request URLs, credentials, ingredient names or account data. */
const MESSAGES=Object.freeze({
 BB_MEAL_PROVIDER_ACCESS:'The AI provider is temporarily unavailable. Please try again later.',
 BB_MEAL_PROVIDER_LIMIT:'The AI provider is busy. Please try again later.',
 BB_MEAL_PROVIDER_UNAVAILABLE:'The AI provider is temporarily unavailable. Please try again shortly.',
 BB_MEAL_PROVIDER_REJECTED:'The AI provider could not complete this request. Please try again shortly.',
 BB_MEAL_PROVIDER_RESPONSE:'The AI provider returned an unreadable response. Please try again shortly.',
 BB_MEAL_RESPONSE_INVALID:'The AI result did not pass its recipe checks. Please try again.',
 BB_MEAL_TIMEOUT:'The AI request took too long. Please try again shortly.',
 BB_MEAL_SERVICE_FAILURE:'AI is temporarily unavailable. Your saved ingredients were not changed. Please try again shortly.'
});
const STAGES=new Set(['request','provider_request','provider_response','response_validation']);
const knownCode=code=>typeof code==='string'&&Object.hasOwn(MESSAGES,code);
export function mealProviderCode(status){
 return status===401||status===403?'BB_MEAL_PROVIDER_ACCESS':status===429?'BB_MEAL_PROVIDER_LIMIT':
  Number.isInteger(status)&&status>=500&&status<=599?'BB_MEAL_PROVIDER_UNAVAILABLE':'BB_MEAL_PROVIDER_REJECTED';
}
export function mealServiceErrorPayload(code){
 const reference=knownCode(code)?code:'BB_MEAL_SERVICE_FAILURE';
 return {error:MESSAGES[reference]+' Reference: '+reference+'.',code:reference};
}
export function logMealDiagnostic(stage,code,status){
 if(!STAGES.has(stage)||!knownCode(code)||!Number.isInteger(status)||status<400||status>599)return false;
 try{console.warn('BB_MEAL_DIAGNOSTIC '+JSON.stringify({stage,code,status}));}catch{}
 return true;
}
