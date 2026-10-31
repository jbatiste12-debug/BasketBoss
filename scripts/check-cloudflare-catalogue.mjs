// Read-only Cloudflare check. Never prints credentials, bindings, recipe content
// or provider error bodies. The private import is deliberately a separate step.
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {recipientForToken} from './private-catalogue-envelope.mjs';

// Logs stay inside the runner. Only these fixed, non-sensitive categories may
// leave it; never return snippets, paths, provider messages or captured matches.
export function classifyBuildFailure(lines) {
  const text=(Array.isArray(lines)?lines:[]).slice(-500).map(x=>typeof x?.line==='string'?x.line.slice(0,5000):'').join('\n');
  const found=[];
  if(/(?:unexpected|expected|unsupported)[^\n]{0,100}\b(?:with|assert)\b|import attributes|import assertions/i.test(text))found.push('json_import_syntax');
  if(/could not resolve|cannot resolve|module not found|no such file/i.test(text))found.push('module_resolution');
  if(/(?:nodejs_compat|node:)[^\n]*(?:required|missing|not supported|compatibility)|(?:missing|required)[^\n]*nodejs_compat/i.test(text))found.push('node_compatibility');
  if(/(?:worker|bundle|script)[^\n]*(?:too large|exceeds|size limit)|(?:exceeds|size limit)[^\n]*(?:worker|bundle|script)/i.test(text))found.push('worker_size_limit');
  if(/(?:file|asset)[^\n]*(?:too large|exceeds|maximum size|25 mib)/i.test(text))found.push('asset_size_limit');
  if(/(?:cpu|startup|memory)[^\n]*(?:limit|exceed|timed out)/i.test(text))found.push('worker_resource_limit');
  if(/(?:invalid|unknown)[^\n]*(?:binding|compatibility|configuration)/i.test(text))found.push('deployment_configuration');
  return found.length?found:['unclassified_build_failure'];
}

// Fetch public marketing assets without credentials. Only fixed booleans leave
// this check; public HTML and unexpected response bodies are never logged.
export async function verifyLandingDeployment(perform = fetch) {
  const options = () => ({cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  let page;
  try { page = await perform('https://basketboss.co.uk/',options()); }
  catch { throw Error('The public landing page could not be checked.'); }
  if(page.status!==200||!/text\/html/i.test(page.headers.get('content-type')||''))
    throw Error('The public landing page is not available on production.');
  let html;
  try { html = await page.text(); }
  catch { throw Error('The public landing page could not be read.'); }
  if(html.length>262144)throw Error('The public landing page response is invalid.');
  const heading=(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  if(heading!=='Less dinner stress. More family time.')
    throw Error('The new family landing headline is not present on production.');
  const sources=[
    {pattern:/<link\b[^>]*\bhref=["'](\/?bb-family-landing\.css(?:\?[^"']*)?)["'][^>]*>/i,type:/text\/css/i},
    {pattern:/<script\b[^>]*\bsrc=["'](\/?bb-family-landing\.js(?:\?[^"']*)?)["'][^>]*>/i,type:/javascript/i}
  ];
  for(const {pattern,type} of sources){
    const source=html.match(pattern)?.[1];
    if(!source)throw Error('The new family landing assets are not referenced on production.');
    let asset;
    try { asset=await perform(new URL(source,'https://basketboss.co.uk/').href,options()); }
    catch { throw Error('A family landing asset could not be checked.'); }
    if(asset.status!==200||!type.test(asset.headers.get('content-type')||''))
      throw Error('A family landing asset is not available on production.');
  }
  const section=[...html.matchAll(/<section\b[^>]*>/gi)].map(match=>match[0]).find(tag=>/\bid=["']smart-receipt["']/i.test(tag));
  if(!section)throw Error('The gated SmartReceipt landing section is missing on production.');
  return {headline:true,stylesheet:true,script:true,smartReceiptSectionVisible:!/\shidden(?:\s|=|>)/i.test(section)};
}

// Verify the native transport on the deployed edge without an account token.
export async function verifyNativeApiDeployment(perform=fetch){
 const address='https://basketboss.co.uk/api/receipt-inventory?mode=status';
 const origin='capacitor://localhost';
 const options={method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type'},redirect:'error',signal:AbortSignal.timeout(15000)};
 let preflight,status,foreign;
 try{
  preflight=await perform(address,options);
  status=await perform(address,{headers:{Origin:origin},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  foreign=await perform(address,{...options,headers:{...options.headers,Origin:'capacitor://localhost.evil'}});
 }catch{throw Error('Native iOS API transport could not be checked.');}
 if(preflight.status!==204||preflight.headers.get('Access-Control-Allow-Origin')!==origin||preflight.headers.get('Access-Control-Allow-Credentials')!==null)throw Error('Native iOS API preflight is not available on production.');
 if(![200,401,403].includes(status.status)||status.headers.get('Access-Control-Allow-Origin')!==origin)throw Error('Native iOS API responses are not available on production.');
 if(foreign.headers.get('Access-Control-Allow-Origin'))throw Error('Native iOS API origin boundary check failed.');
 return {preflight:true,responseHeaders:true,foreignOriginDenied:true};
}

// Fixed public review-readiness signals; never deletes an account or sends auth.
export async function verifyReviewDeployment(perform=fetch){
 const options={cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)};
 try{
  for(const path of ['/privacy','/terms']){
   const page=await perform('https://basketboss.co.uk'+path,options);
   if(page.status!==200||!/text\/html/i.test(page.headers.get('content-type')||''))throw Error();
   const html=await page.text();if(!html.includes('31 October 2026'))throw Error();
  }
  const response=await perform('https://basketboss.co.uk/api/account/delete',{...options,headers:{Origin:'capacitor://localhost'}});
  const status=await response.json();
  if(response.status!==200||status?.ok!==true||typeof status.available!=='boolean'||typeof status.migrationReady!=='boolean'||response.headers.get('Access-Control-Allow-Origin')!=='capacitor://localhost')throw Error();
  const checkout=await perform('https://basketboss.co.uk/api/subscription/checkout-config',{...options,headers:{Origin:'capacitor://localhost'}});
  if((await checkout.json())?.enabled!==false)throw Error();
  return {privacy:true,terms:true,deletionRoute:true,deletionConfigured:status.available,deletionMigrationReady:status.migrationReady,nativeWebCheckoutDisabled:true};
 }catch{throw Error('App review compliance routes could not be verified on production.');}
}

// Inspect schema only. Never select customer rows, identifiers or table SQL.
export async function inspectDeletionSchema(query){
 const required={
  paidEntitlements:['bb_paid_entitlements',['user_id','paddle_subscription_id']],
  billingClaims:['bb_billing_claims',['user_id','claim_id','transaction_id','claim_state','slot_no']],
  founderSlots:['bb_founder_slots',['user_id','slot_no','state','reservation_token_hash','paddle_subscription_id','reservation_expires_at_ms','updated_at_ms']],
  aiDailyUsage:['bb_ai_daily_usage',['actor']],
  deletionJournal:['bb_account_deletions',['actor_hash','retry_hash','user_id','email','started_at_ms','completed_at_ms','locked_until_ms']],
  deletionReferences:['bb_account_deletion_refs',['ref_hash']]
 };
 const tables=await query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ("+Object.values(required).map(([table])=>"'"+table+"'").join(',')+")");
 const result={};
 for(const [label,[table,columns]] of Object.entries(required)){
  const present=tables.some(row=>row.name===table);
  const metadata=present?await query("SELECT name FROM pragma_table_info('"+table+"')"):[];
  result[label]={present,compatible:present&&columns.every(name=>metadata.some(row=>row.name===name))};
 }
 return result;
}

export async function inspectCloudflare(env, perform = fetch) {
  if (!env.CLOUDFLARE_API_TOKEN) throw Error('Add CLOUDFLARE_API_TOKEN to the github-pages environment secrets.');
  async function api(path, body, operation = 'Cloudflare request', includePagination = false) {
    const response = await perform('https://api.cloudflare.com/client/v4/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {Authorization: 'Bearer ' + env.CLOUDFLARE_API_TOKEN, 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    const parsed = await response.json().catch(() => null);
    if (!response.ok || parsed?.success !== true) {
      const codes = (Array.isArray(parsed?.errors) ? parsed.errors : []).map(e => e?.code).filter(Number.isSafeInteger).slice(0, 5);
      const hint = [401, 403].includes(response.status) ? ' Check token permissions and account scope.' : ' Check the API request format and service status.';
      throw Error(operation + ' failed (HTTP ' + response.status + (codes.length ? '; Cloudflare codes ' + codes.join(', ') : '') + ').' + hint);
    }
    return includePagination ? {results: parsed.result, pagination: parsed.result_info} : parsed.result;
  }
  let accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId) {
    let accounts;
    try { accounts = await api('accounts?per_page=2', undefined, 'Account discovery'); }
    catch { throw Error('Account discovery failed. Add CLOUDFLARE_ACCOUNT_ID as an environment variable in github-pages, then rerun this check.'); }
    if (!Array.isArray(accounts) || accounts.length !== 1) throw Error('Add CLOUDFLARE_ACCOUNT_ID in github-pages to select the BasketBoss account.');
    accountId = accounts[0].id;
  }
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw Error('CLOUDFLARE_ACCOUNT_ID must be the 32-character Cloudflare account ID.');
  const prefix = 'accounts/' + accountId;
  const projects = [];
  for (let page = 1; ; page++) {
    if (page > 100) throw Error('Pages project list is too large; manual account review required.');
    const batch = await api(prefix + '/pages/projects?per_page=10&page=' + page, undefined, 'Pages project listing', true);
    if (!Array.isArray(batch.results) || batch.results.length > 10) throw Error('Pages project list is invalid.');
    projects.push(...batch.results);
    if (batch.results.length < 10 || Number.isSafeInteger(batch.pagination?.total_pages) && page >= batch.pagination.total_pages) break;
  }
  const matches = projects.filter(p => p.domains?.some(d => ['basketboss.co.uk', 'www.basketboss.co.uk'].includes(d)));
  if (matches.length !== 1) throw Error('Could not uniquely match the Pages project serving basketboss.co.uk. Check the account and Pages Read permission.');
  const project = await api(prefix + '/pages/projects/' + encodeURIComponent(matches[0].name), undefined, 'Production Pages binding lookup');
  if (project.production_branch !== 'main') throw Error('The matched Pages project does not use main as its production branch.');
  const dbId = project.deployment_configs?.production?.d1_databases?.BILLING_DB?.id;
  if (!/^[0-9a-f-]{36}$/i.test(dbId || '')) throw Error('The production BILLING_DB D1 binding could not be identified.');
  const query = async sql => {
    const result = await api(prefix + '/d1/database/' + dbId + '/query', {sql}, 'D1 catalogue read');
    if (!Array.isArray(result) || result.length !== 1 || result[0].success === false || !Array.isArray(result[0].results)) throw Error('Database read returned an invalid result.');
    return result[0].results;
  };
  const tables = await query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bb_private_premium_recipes','bb_private_premium_recipes_500_v1')");
  const counts = {};
  for (const name of ['bb_private_premium_recipes', 'bb_private_premium_recipes_500_v1']) {
    counts[name] = tables.some(t => t.name === name) ? Number((await query('SELECT COUNT(*) AS count FROM ' + name))[0]?.count) : null;
    if (counts[name] !== null && !Number.isSafeInteger(counts[name])) throw Error('Database recipe count is invalid.');
  }
  const deletionSchema=await inspectDeletionSchema(query);
  const latest = project.latest_deployment;
  const latestDeployment = latest ? {id: latest.id, commit: latest.deployment_trigger?.metadata?.commit_hash || null,
    stage: latest.latest_stage?.name || null, status: latest.latest_stage?.status || null} : null;
  let failed = latestDeployment?.status === 'failure' ? latest : null;
  if (latestDeployment && latestDeployment.status !== 'success' && !failed) {
    try {
      const history=await api(prefix+'/pages/projects/'+encodeURIComponent(project.name)+'/deployments?env=production&per_page=10&page=1',undefined,'Pages deployment history');
      failed=(Array.isArray(history)?history:[]).find(d=>d.latest_stage?.status==='failure'&&d.environment==='production')||null;
    } catch { /* Connection validation remains useful if history is unavailable. */ }
  }
  const diagnosedFailure = failed ? {id:failed.id,commit:failed.deployment_trigger?.metadata?.commit_hash||null} : null;
  let buildFailureCategories = [];
  if (diagnosedFailure && /^[a-f0-9-]{36}$/i.test(diagnosedFailure.id || '')) {
    try {
      const logs = await api(prefix + '/pages/projects/' + encodeURIComponent(project.name) + '/deployments/' + diagnosedFailure.id + '/history/logs', undefined, 'Pages build diagnostics');
      buildFailureCategories = classifyBuildFailure(logs?.data);
    } catch {buildFailureCategories = ['diagnostics_unavailable'];}
  }
  return {accountId, project: project.name, branch: project.production_branch, databaseId: dbId, latestDeployment, diagnosedFailure, buildFailureCategories,
    productionCommit: project.canonical_deployment?.deployment_trigger?.metadata?.commit_hash || null,
    counts, deletionSchema, expandedCatalogueReady: counts.bb_private_premium_recipes_500_v1 === 400};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let text;
  try {
    let result = await inspectCloudflare(process.env);
    const expectedCommit=process.env.GITHUB_SHA;
    for(let attempt=0;expectedCommit&&result.productionCommit!==expectedCommit&&attempt<24;attempt++){
      if(result.latestDeployment?.commit===expectedCommit&&result.latestDeployment.status==='failure')
        throw Error('Production deployment failed: '+result.buildFailureCategories.join(', '));
      await new Promise(resolve=>setTimeout(resolve,5000));
      result=await inspectCloudflare(process.env);
    }
    if(expectedCommit&&result.productionCommit!==expectedCommit)throw Error('Production has not reached this workflow commit yet. Check the Pages deployment status.');
    result.landingDeployment=await verifyLandingDeployment();
    result.nativeApiDeployment=await verifyNativeApiDeployment();
    result.reviewDeployment=await verifyReviewDeployment();
    const asset=await fetch('https://basketboss.co.uk/bb-receipt-host.js',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!asset.ok||!/javascript/i.test(asset.headers.get('content-type')||''))throw Error('The receipt frontend asset is not available on production.');
    const receipt=await fetch('https://basketboss.co.uk/api/receipt-inventory?mode=status',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(![200,401,403].includes(receipt.status)||!/json/i.test(receipt.headers.get('content-type')||''))throw Error('The receipt API status route is not available on production.');
    if(receipt.status===200){const readiness=await receipt.json();if(readiness?.ok!==true||typeof readiness.available!=='boolean')throw Error('The receipt API status response is invalid.');}
    result.receiptDeployment={staticAsset:true,statusRoute:true,statusHttp:receipt.status};
    text = 'Cloudflare connection verified.\n\n```json\n' + JSON.stringify(result, null, 2) + '\n```\n\nRead-only check; no database import or configuration changes were performed.\n';
    const notice = (title, value) => console.log('::notice title=' + title + '::' + JSON.stringify(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
    notice('Cloudflare catalogue connection', result);
    // Only this public encryption key leaves the runner. The token and derived
    // private key remain in memory; no extra user-managed secret is required.
    notice('Catalogue import public key', recipientForToken(process.env.CLOUDFLARE_API_TOKEN));
  } catch (error) {
    text = 'Cloudflare connection check incomplete: ' + error.message + '\n';
    // Public annotations remain readable when GitHub requires sign-in for logs.
    // Emit our bounded diagnostic only; never include a provider response body.
    const annotation = text.slice(0, 1000).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.error('::error title=Cloudflare catalogue connection::' + annotation);
    process.exitCode = 1;
  }
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}
