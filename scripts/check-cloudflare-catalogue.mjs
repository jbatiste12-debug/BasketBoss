// Read-only Cloudflare check. Never prints credentials, bindings, recipe content
// or provider error bodies. The private import is deliberately a separate step.
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export async function inspectCloudflare(env, perform = fetch) {
  if (!env.CLOUDFLARE_API_TOKEN) throw Error('Add CLOUDFLARE_API_TOKEN to the github-pages environment secrets.');
  async function api(path, body) {
    const response = await perform('https://api.cloudflare.com/client/v4/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {Authorization: 'Bearer ' + env.CLOUDFLARE_API_TOKEN, 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    const parsed = await response.json().catch(() => null);
    if (!response.ok || parsed?.success !== true) throw Error('Cloudflare request failed (HTTP ' + response.status + '). Check token permissions and account scope.');
    return parsed.result;
  }
  let accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId) {
    let accounts;
    try { accounts = await api('accounts?per_page=2'); }
    catch { throw Error('Account discovery failed. Add CLOUDFLARE_ACCOUNT_ID as an environment variable in github-pages, then rerun this check.'); }
    if (!Array.isArray(accounts) || accounts.length !== 1) throw Error('Add CLOUDFLARE_ACCOUNT_ID in github-pages to select the BasketBoss account.');
    accountId = accounts[0].id;
  }
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw Error('CLOUDFLARE_ACCOUNT_ID must be the 32-character Cloudflare account ID.');
  const prefix = 'accounts/' + accountId;
  const projects = await api(prefix + '/pages/projects?per_page=100');
  if (!Array.isArray(projects) || projects.length >= 100) throw Error('Pages project list is incomplete; manual account review required.');
  const matches = projects.filter(p => p.domains?.some(d => ['basketboss.co.uk', 'www.basketboss.co.uk'].includes(d)));
  if (matches.length !== 1) throw Error('Could not uniquely match the Pages project serving basketboss.co.uk. Check the account and Pages Read permission.');
  const project = await api(prefix + '/pages/projects/' + encodeURIComponent(matches[0].name));
  if (project.production_branch !== 'main') throw Error('The matched Pages project does not use main as its production branch.');
  const dbId = project.deployment_configs?.production?.d1_databases?.BILLING_DB?.id;
  if (!/^[0-9a-f-]{36}$/i.test(dbId || '')) throw Error('The production BILLING_DB D1 binding could not be identified.');
  const query = async sql => {
    const result = await api(prefix + '/d1/database/' + dbId + '/query', {sql});
    if (!Array.isArray(result) || result.length !== 1 || result[0].success === false || !Array.isArray(result[0].results)) throw Error('Database read returned an invalid result.');
    return result[0].results;
  };
  const tables = await query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bb_private_premium_recipes','bb_private_premium_recipes_500_v1')");
  const counts = {};
  for (const name of ['bb_private_premium_recipes', 'bb_private_premium_recipes_500_v1']) {
    counts[name] = tables.some(t => t.name === name) ? Number((await query('SELECT COUNT(*) AS count FROM ' + name))[0]?.count) : null;
    if (counts[name] !== null && !Number.isSafeInteger(counts[name])) throw Error('Database recipe count is invalid.');
  }
  return {project: project.name, branch: project.production_branch, databaseId: dbId,
    productionCommit: project.canonical_deployment?.deployment_trigger?.metadata?.commit_hash || null,
    counts, expandedCatalogueReady: counts.bb_private_premium_recipes_500_v1 === 400};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let text;
  try {
    const result = await inspectCloudflare(process.env);
    text = 'Cloudflare connection verified.\n\n```json\n' + JSON.stringify(result, null, 2) + '\n```\n\nRead-only check; no database import or configuration changes were performed.\n';
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
