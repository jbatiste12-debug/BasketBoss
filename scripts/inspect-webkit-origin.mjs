// Isolated macOS WKWebView reproduction. Loopback HTTP only; no credentials or account APIs.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const WEBKIT_ORIGIN_CASES=Object.freeze([
 {id:'default_meta_default_fetch',meta:false,policy:'default'},
 {id:'no_referrer_meta_default_fetch',meta:true,policy:'default'},
 {id:'no_referrer_meta_origin_fetch',meta:true,policy:'origin'}
]);
const ORIGINS=new Set(['same-origin','null','missing','other']);
const REFERERS=new Set(['full-fixture','origin-only','missing','other']);
export function webkitOriginHTML(scenario){
 return '<!doctype html><html><head><meta charset="utf-8">'+(scenario.meta?'<meta name="referrer" content="no-referrer">':'')+
  '<title>Local Origin probe</title></head><body><script>(async()=>{try{'+
  'const response=await fetch("/echo",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",'+
  (scenario.policy==='origin'?'referrerPolicy:"origin",':'')+'signal:AbortSignal.timeout(8000)});'+
  'const echo=await response.json();window.webkit.messageHandlers.probe.postMessage({ok:response.ok,echo});'+
  '}catch{window.webkit.messageHandlers.probe.postMessage({ok:false});}})();</script></body></html>';
}
export async function createWebkitOriginFixture(){
 let origin;
 const server=http.createServer(async(request,response)=>{
  const url=new URL(request.url,origin);
  response.setHeader('Cache-Control','no-store');
  if(request.method==='GET'&&url.pathname==='/fixture'){
   const scenario=WEBKIT_ORIGIN_CASES.find(value=>value.id===url.searchParams.get('case'));
   if(scenario){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(webkitOriginHTML(scenario));return;}
  }
  if(request.method==='POST'&&url.pathname==='/echo'){
   let size=0,body='';
   try{for await(const part of request){size+=part.length;if(size>2)break;body+=part;}}catch{}
   if(size!==2||body!=='{}'){response.writeHead(400);response.end();return;}
   const suppliedOrigin=request.headers.origin,suppliedReferer=request.headers.referer;
   const originKind=suppliedOrigin===origin?'same-origin':suppliedOrigin==='null'?'null':suppliedOrigin?'other':'missing';
   let refererKind=suppliedReferer?'other':'missing';
   if(suppliedReferer===origin+'/')refererKind='origin-only';
   else if(typeof suppliedReferer==='string')try{const value=new URL(suppliedReferer);if(value.origin===origin&&value.pathname==='/fixture'&&WEBKIT_ORIGIN_CASES.some(item=>item.id===value.searchParams.get('case')))refererKind='full-fixture';}catch{}
   response.setHeader('Content-Type','application/json');response.end(JSON.stringify({origin:originKind,referer:refererKind}));return;
  }
  response.writeHead(404);response.end();
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port;
 return {origin,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

const SWIFT=String.raw`
import AppKit
import WebKit
import Foundation
import Darwin

final class Probe: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    var finished = false
    func finish(_ value: [String: Any], _ code: Int32 = 0) {
        if finished { return }; finished = true
        if let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
           let text = String(data: bytes, encoding: .utf8) { print(text); fflush(stdout) }
        exit(code)
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "probe", message.frameInfo.isMainFrame,
              message.webView?.url?.host == "127.0.0.1", let body = message.body as? [String: Any] else {
            finish(["ok": false], 1); return
        }
        finish(body, (body["ok"] as? Bool) == true ? 0 : 1)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(["ok": false], 1) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(["ok": false], 1) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish(["ok": false], 1) }
}
guard CommandLine.arguments.count == 2, let url = URL(string: CommandLine.arguments[1]),
      url.scheme == "http", url.host == "127.0.0.1", url.port != nil, url.path == "/fixture",
      url.user == nil, url.password == nil else { exit(2) }
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let probe = Probe(), config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
config.userContentController.add(probe, name: "probe")
let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 640, height: 480), configuration: config)
webView.navigationDelegate = probe
let window = NSWindow(contentRect: webView.frame, styleMask: [.titled], backing: .buffered, defer: false)
window.contentView = webView
window.orderFrontRegardless()
DispatchQueue.main.asyncAfter(deadline: .now() + 20) { probe.finish(["ok": false], 1) }
webView.load(URLRequest(url: url))
app.run()
`;

function run(program,args,timeoutMs){
 return new Promise((resolve,reject)=>{
  const child=spawn(program,args,{stdio:['ignore','pipe','pipe']});let output='',settled=false;
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(Error('probe_process_failed')):resolve(output);};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(true);},timeoutMs);
  child.stdout.on('data',part=>{if(output.length+part.length>8192){child.kill('SIGKILL');finish(true);}else output+=part;});
  child.stderr.resume();child.once('error',()=>finish(true));child.once('close',code=>finish(code!==0));
 });
}
export async function inspectWebkitOrigin(){
 if(process.platform!=='darwin')throw Error('macos_required');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'basketboss-webkit-origin-'));
 let fixture,stage='compile';
 try{
  const source=path.join(temporary,'OriginProbe.swift'),executable=path.join(temporary,'origin-probe');
  await fs.writeFile(source,SWIFT);
  await run('xcrun',['swiftc',source,'-framework','AppKit','-framework','WebKit','-o',executable],90000);
  fixture=await createWebkitOriginFixture();
  for(const scenario of WEBKIT_ORIGIN_CASES){
   stage=scenario.id;
   const result=JSON.parse(await run(executable,[fixture.origin+'/fixture?case='+scenario.id],25000));
   if(result.ok!==true||!ORIGINS.has(result.echo?.origin)||!REFERERS.has(result.echo?.referer))throw Error('probe_result_invalid');
   console.log(JSON.stringify({kind:'webkit_origin',case:scenario.id,ok:true,origin:result.echo.origin,referer:result.echo.referer}));
  }
 }catch{throw Error(stage==='compile'?'webkit_compile_failed':'webkit_scenario_failed:'+stage);}
 finally{await fixture?.close();await fs.rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await inspectWebkitOrigin();}catch(error){
  const known=/^(?:macos_required|webkit_compile_failed|webkit_scenario_failed:(?:default_meta_default_fetch|no_referrer_meta_default_fetch|no_referrer_meta_origin_fetch))$/;
  console.log(JSON.stringify({kind:'webkit_origin',ok:false,error:known.test(error.message)?error.message:'probe_failed'}));process.exitCode=1;
 }
}
