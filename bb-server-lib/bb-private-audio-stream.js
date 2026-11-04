/* Live conversational audio is never cached. Native callers still use the
 * complete buffered MP3; browsers explicitly opt into this progressive path. */
import {cookServiceCode,cookServiceError} from './bb-cook-service-error.js';

export async function privateAudioResponse(speech,{signal,guard,cancel,diagnostic,clock=Date.now}={}){
 const reader=speech.getReader();let closed=false,checked=-Infinity;
 const refresh=async(force=false)=>{if(force||clock()-checked>=200){await guard?.();checked=clock();}signal?.throwIfAborted();};
 try{
  // requestSpeech withholds bytes until its MP3 prefix has been validated.
  const first=await reader.read();if(first.done)throw cookServiceError('BB_COOK_PROVIDER_RESPONSE');
  await refresh(true);
  let pending=first.value;
  const body=new ReadableStream({
   async pull(output){
    try{
     if(pending){signal?.throwIfAborted();output.enqueue(pending);pending=null;return;}
     const next=await reader.read();await refresh(next.done);
     if(next.done){closed=true;cancel?.();output.close();return;}
     output.enqueue(next.value);
    }catch(error){
     if(!closed){const code=signal?.aborted?'BB_COOK_REQUEST_CANCELLED':cookServiceCode(error);closed=true;cancel?.();void reader.cancel().catch(()=>{});diagnostic?.(code);output.error(cookServiceError(code));}
    }
   },
   cancel(){closed=true;cancel?.();return reader.cancel();}
  });
  return new Response(body,{headers:{'Content-Type':'audio/mpeg','Cache-Control':'private, no-store, no-transform','Vary':'Authorization, Origin, Accept','X-Content-Type-Options':'nosniff','X-BB-TTS-Cache':'bypass'}});
 }catch(error){cancel?.();void reader.cancel().catch(()=>{});throw error;}
}
