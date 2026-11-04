/* Opt-in spoken-answer streaming. Never forward provider frames or metadata. */
import {cookingProviderRequest,COOK_ASSISTANT_ANSWER_LIMIT} from './bb-cook-assistant.js';
import {cookServiceError,cookProviderError,cookServiceCode} from './bb-cook-service-error.js';

const PROVIDER_BYTES=65536,FRAME_BYTES=16384,MAX_EVENTS=512;
const invalid=()=>cookServiceError('BB_COOK_PROVIDER_RESPONSE');
const abortError=()=>Object.assign(Error('aborted'),{name:'AbortError'});
const controls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

async function* events(response,signal){
 const declared=response.headers.get('Content-Length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>PROVIDER_BYTES)){void response.body?.cancel().catch(()=>{});throw invalid();}
 const reader=response.body?.getReader();if(!reader)throw invalid();
 const decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',size=0,count=0,rejectAbort;
 const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(abortError());});
 signal.addEventListener('abort',rejectAbort,{once:true});
 try{
  for(;;){
   if(signal.aborted)throw abortError();
   const {value,done}=await Promise.race([reader.read(),aborted]);
   if(done){buffer+=decoder.decode();if(buffer.trim())throw invalid();return;}
   size+=value.byteLength;if(size>PROVIDER_BYTES)throw invalid();
   buffer+=decoder.decode(value,{stream:true});
   for(;;){
    const boundary=/\r?\n\r?\n/.exec(buffer);if(!boundary)break;
    const frame=buffer.slice(0,boundary.index);buffer=buffer.slice(boundary.index+boundary[0].length);
    if(frame.length>FRAME_BYTES||++count>MAX_EVENTS)throw invalid();
    let name=null;const data=[];
    for(const line of frame.split(/\r?\n/)){
     if(!line||line.startsWith(':'))continue;
     const at=line.indexOf(':'),key=at<0?line:line.slice(0,at),field=at<0?'':line.slice(at+1).replace(/^ /,'');
     if(key==='event'){if(name!==null)throw invalid();name=field;}
     else if(key==='data')data.push(field);
     else if(!['id','retry'].includes(key))throw invalid();
    }
    if(!data.length)continue;
    let event;try{event=JSON.parse(data.join('\n'));}catch{throw invalid();}
    if(!event||typeof event.type!=='string'||name!==null&&name!==event.type)throw invalid();
    yield event;
   }
   if(buffer.length>FRAME_BYTES)throw invalid();
  }
 }finally{signal.removeEventListener('abort',rejectAbort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}

function validMessage(message,answer){
 return message?.type==='message'&&message.role==='assistant'&&message.status==='completed'&&Array.isArray(message.content)&&message.content.length===1&&message.content[0]?.type==='output_text'&&message.content[0].text===answer;
}

export async function* requestCookingAnswerStream(value,env,perform=fetch,signal){
 const local=new AbortController(),deadline=AbortSignal.timeout(25000),combined=AbortSignal.any([local.signal,deadline,...(signal?[signal]:[])]);
 let response,rejectAbort;
 const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(abortError());});
 combined.addEventListener('abort',rejectAbort,{once:true});
 try{
  if(combined.aborted)throw abortError();
  // Manual redirects keep credentials on the fixed OpenAI origin in Workers.
  response=await Promise.race([perform('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify(cookingProviderRequest(value,{stream:true})),redirect:'manual',signal:combined}),aborted]);
  if(!response.ok)throw cookProviderError(response.status);
  if(!/^text\/event-stream(?:;|$)/i.test(response.headers.get('Content-Type')||''))throw invalid();
  let answer='',itemId=null,part=false,textDone=false,partDone=false,itemDone=false;
  for await(const event of events(response,combined)){
   if(event.type==='response.created'||event.type==='response.in_progress')continue;
   if(event.type==='response.output_item.added'){
    const item=event.item;
    if(itemId||event.output_index!==0||item?.type!=='message'||item.role!=='assistant'||typeof item.id!=='string'||!item.id||item.id.length>200||!Array.isArray(item.content)||item.content.length)throw invalid();
    itemId=item.id;continue;
   }
   if(event.type==='response.content_part.added'){
    if(!itemId||part||event.item_id!==itemId||event.output_index!==0||event.content_index!==0||event.part?.type!=='output_text'||event.part.text!=='')throw invalid();
    part=true;continue;
   }
   if(event.type==='response.output_text.delta'){
    if(!part||textDone||event.item_id!==itemId||event.output_index!==0||event.content_index!==0||typeof event.delta!=='string'||!event.delta||controls.test(event.delta)||answer.length+event.delta.length>COOK_ASSISTANT_ANSWER_LIMIT)throw invalid();
    answer+=event.delta;
    // JSON/tool-shaped completions are never treated as spoken answer tokens.
    if(/^[\s]*[\[{]/.test(answer))throw invalid();
    yield event.delta;continue;
   }
   if(event.type==='response.output_text.done'){
    if(!part||textDone||event.item_id!==itemId||event.output_index!==0||event.content_index!==0||event.text!==answer)throw invalid();
    textDone=true;continue;
   }
   if(event.type==='response.content_part.done'){
    if(!textDone||partDone||event.item_id!==itemId||event.output_index!==0||event.content_index!==0||event.part?.type!=='output_text'||event.part.text!==answer)throw invalid();
    partDone=true;continue;
   }
   if(event.type==='response.output_item.done'){
    if(!partDone||itemDone||event.output_index!==0||event.item?.id!==itemId||!validMessage(event.item,answer))throw invalid();
    itemDone=true;continue;
   }
   if(event.type==='response.completed'){
    const result=event.response;
    if(!itemDone||!answer.trim()||result?.status!=='completed'||!Array.isArray(result.output)||result.output.length!==1||result.output[0]?.id!==itemId||!validMessage(result.output[0],answer))throw invalid();
    return;
   }
   if(event.type==='error'||event.type==='response.failed'||event.type==='response.incomplete')throw cookServiceError('BB_COOK_PROVIDER_UNAVAILABLE');
   // Includes refusals, tools, extra messages, annotations and unknown events.
   throw invalid();
  }
  throw invalid(); // EOF without a verified completion cannot be a success.
 }catch(error){
  if(signal?.aborted)throw abortError();
  if(combined.aborted)throw cookServiceError('BB_COOK_PROVIDER_UNAVAILABLE');
  if(cookServiceCode(error)!=='BB_COOK_SERVICE_FAILURE')throw error;
  throw response?invalid():cookServiceError('BB_COOK_PROVIDER_UNAVAILABLE');
 }finally{
  combined.removeEventListener('abort',rejectAbort);local.abort();
  if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{});
 }
}

// Check deletion before the first chunk, at most 200ms apart, and at completion.
// A DB round trip per token would serialize and stall the provider stream.
// No content is persisted, cached, or included in diagnostics. Cancellation aborts the fetch
// and any stalled provider reader, even if no further tokens arrive.
export function cookingAnswerStreamResponse(value,env,{perform=fetch,signal,guard,diagnostic,clock=Date.now}={}){
 const controller=new AbortController(),combined=AbortSignal.any([controller.signal,...(signal?[signal]:[])]),encoder=new TextEncoder();let closed=false;
 let checked=-Infinity;
 const refresh=async(force=false)=>{if(force||clock()-checked>=200){await guard?.();checked=clock();}};
 const stream=new ReadableStream({
  async start(output){
   const send=frame=>{if(!closed)output.enqueue(encoder.encode(JSON.stringify(frame)+'\n'));};
   try{
    for await(const delta of requestCookingAnswerStream(value,env,perform,combined)){
     await refresh();if(combined.aborted)throw abortError();send({type:'delta',text:delta});
    }
    await refresh(true);if(combined.aborted)throw abortError();send({type:'done'});
   }catch(error){
    const code=combined.aborted?'BB_COOK_REQUEST_CANCELLED':cookServiceCode(error);
    if(!closed){diagnostic?.(code);send({type:'error',code});}
   }finally{controller.abort();if(!closed){closed=true;output.close();}}
  },
  cancel(){closed=true;controller.abort();}
 });
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'private, no-store, no-transform','X-Content-Type-Options':'nosniff','Vary':'Authorization, Accept'}});
}
