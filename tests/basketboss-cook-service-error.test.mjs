import test from 'node:test';
import assert from 'node:assert/strict';
import {cookServiceError,cookServiceCode,cookProviderError} from '../bb-server-lib/bb-cook-service-error.js';

test('Cook diagnostics accept only server-owned fixed categories',()=>{
 for(const code of ['BB_COOK_PROVIDER_ACCESS','BB_COOK_PROVIDER_LIMIT','BB_COOK_PROVIDER_UNAVAILABLE','BB_COOK_PROVIDER_RESPONSE','BB_COOK_PROVIDER_REJECTED'])assert.equal(cookServiceCode(cookServiceError(code)),code);
 for(const error of [Error('private user data'),{code:'BB_COOK_PROVIDER_ACCESS',message:'private user data'},null,'private user data',cookServiceError('private user data')])assert.equal(cookServiceCode(error),'BB_COOK_SERVICE_FAILURE');
 assert.equal(cookServiceError('private user data').message,'BB_COOK_SERVICE_FAILURE');
 for(const [status,code]of [[401,'BB_COOK_PROVIDER_ACCESS'],[403,'BB_COOK_PROVIDER_ACCESS'],[429,'BB_COOK_PROVIDER_LIMIT'],[500,'BB_COOK_PROVIDER_UNAVAILABLE'],[599,'BB_COOK_PROVIDER_UNAVAILABLE'],[302,'BB_COOK_PROVIDER_REJECTED'],[400,'BB_COOK_PROVIDER_REJECTED']])assert.equal(cookServiceCode(cookProviderError(status)),code);
});
