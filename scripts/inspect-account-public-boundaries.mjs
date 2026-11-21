// Operational, credential-free HTTP probes only. No login, DELETE confirmation,
// password, valid bearer, provider action, configuration or database write.
const REPO='jbatiste12-debug/BasketBoss';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!==REPO||!['refs/heads/main','refs/heads/diagnostics/account-delete-public-20261121'].includes(process.env.GITHUB_REF))throw Error('Approved diagnostic ref required');
const native='capacitor://localhost';
const hosts=[['apex','https://basketboss.co.uk'],['www','https://www.basketboss.co.uk']];
const codes=new Set(['deletion_origin_rejected','deletion_sign_in_required','deletion_unavailable','deletion_confirmation_required']);
const reasons=new Set(['server_not_configured','authentication_required','billing_not_enabled']);
async function boundedJson(response){
 const reader=response.body?.getReader();if(!reader)return null;
 let length=0;const parts=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>4096)return null;parts.push(value);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
 catch{return null;}finally{try{await reader.cancel();}catch{}}
}
function redirectKind(value){
 try{const h=new URL(value).hostname;if(h==='basketboss.co.uk')return 'apex';if(h==='www.basketboss.co.uk')return 'www';if(h.endsWith('.cloudflareaccess.com'))return 'cloudflare_access';return 'other';}catch{return null;}
}
async function probe(label,host,route,method,origin){
 const headers={Origin:origin,Accept:'application/json'};
 if(method==='POST')headers['Content-Type']='application/json';
 if(method==='OPTIONS'){headers['Access-Control-Request-Method']='POST';headers['Access-Control-Request-Headers']='authorization, content-type';}
 const result={host:label,route,method,origin:origin===native?'native':'web'};
 try{
  const r=await fetch(host+route,{method,headers,...(method==='POST'?{body:'{}'}:{}),redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000)});
  const type=(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  Object.assign(result,{status:r.status,contentType:['application/json','text/html'].includes(type)?type:'other',redirect:redirectKind(r.headers.get('location')),challenge:r.headers.get('cf-mitigated')==='challenge',nativeCors:r.headers.get('access-control-allow-origin')===native});
  const data=type==='application/json'?await boundedJson(r):null;
  if(!data)try{await r.body?.cancel();}catch{}
  if(codes.has(data?.code))result.code=data.code;
  if(reasons.has(data?.reason))result.reason=data.reason;
  for(const key of ['available','migrationReady','configured'])if(typeof data?.[key]==='boolean')result[key]=data[key];
 }catch{result.transport='unavailable';}
 console.log(JSON.stringify(result));
}
await Promise.all(hosts.map(async([label,host])=>{
 for(const [route,method,origin]of [
  ['/api/account/delete','GET',native],
  ['/api/account/delete','OPTIONS',native],
  ['/api/account/delete','POST',native],
  ['/api/account/delete','POST',host],
  ['/api/household?mode=status','GET',native],
  ['/api/subscription/status','GET',native]
 ])await probe(label,host,route,method,origin);
}));
