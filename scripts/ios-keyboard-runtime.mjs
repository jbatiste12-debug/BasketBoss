// Prefer the already exercised simulator in isolated GitHub Actions runners.
// A local developer's existing simulator and app data are never selected/reset.
export function keyboardRuntimePlan({runtimes=[],devices={},githubActions=false}={}){
 const priority=version=>/^26\.2(?:\.|$)/.test(version)?0:/^18\.6(?:\.|$)/.test(version)?1:2;
 const ordered=runtimes.filter(item=>item?.isAvailable&&item.name?.startsWith('iOS')).sort((a,b)=>priority(a.version)-priority(b.version)||b.version.localeCompare(a.version,undefined,{numeric:true}));
 if(githubActions)for(const runtime of ordered){
  const phone=(devices[runtime.identifier]||[]).find(item=>item.isAvailable&&item.name?.startsWith('iPhone')&&item.state==='Booted');
  if(phone)return {runtimes:ordered,reuse:{id:phone.udid,name:phone.name,runtimeVersion:runtime.version},resetSyntheticCIApp:true};
 }
 return {runtimes:ordered,reuse:null,resetSyntheticCIApp:false};
}
