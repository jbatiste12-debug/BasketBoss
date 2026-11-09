// Evaluate the worker's actual concatenated public inventory without lifecycle
// execution, network requests or a regex that can cross into fetch handlers.
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../../',import.meta.url),scope='https://basketboss.co.uk/';
export function readWorkerInventory(source=fs.readFileSync(new URL('service-worker.js',root),'utf8')){
 const self={registration:{scope},addEventListener(){}};
 let context,imports=0;
 context=vm.createContext({self,URL,importScripts(address){
  const url=new URL(address);if(url.origin!=='https://basketboss.co.uk'||url.pathname!=='/pwa700/precache.js')throw Error('Unexpected worker inventory import');
  imports++;vm.runInContext(fs.readFileSync(new URL('pwa700/precache.js',root),'utf8'),context,{filename:'public-pwa-precache.js'});
 }});
 vm.runInContext(source+'\nglobalThis.__inventory={core:CORE,pwa:PWA700_CORE,cache:CACHE,base:CACHE_BASE,version:self.BB700_PWA_CACHE_VERSION};',context,{filename:'service-worker.js'});
 const result=context.__inventory;
 return {core:Array.from(result.core),pwa:Array.from(result.pwa),cache:result.cache,base:result.base,version:result.version,imports};
}
