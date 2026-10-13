import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const website=resolve(root,'../KITTY CORP STARTUP WEBSITE');
const envFile=join(website,'.env.local');
const backup=join(root,'.tooling/secrets/commerce-gateway.json');
const backend='https://kitty-ai-v2.kitty-ai.workers.dev';
function envValue(text,key){return text.split(/\r?\n/).find(x=>x.startsWith(key+'='))?.slice(key.length+1).trim().replace(/^['"]|['"]$/g,'');}
async function main(){
 if(!existsSync(envFile))throw Error('Website private environment file is missing.');
 const original=readFileSync(envFile,'utf8');
 const stored=existsSync(backup)?JSON.parse(readFileSync(backup,'utf8')).token:null;
 const existing=envValue(original,'KITTY_COMMERCE_GATEWAY_TOKEN');
 if(stored&&existing&&stored!==existing)throw Error('Private gateway values differ; reconcile privately before continuing.');
 const token=stored||existing||randomBytes(32).toString('hex');
 if(!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw Error('Gateway token format is not valid.');
 mkdirSync(dirname(backup),{recursive:true});
 if(!stored)writeFileSync(backup,JSON.stringify({token}),{mode:0o600});
 const cli=spawnSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'secret','put','COMMERCE_GATEWAY_TOKEN','--config',join(root,'backend/wrangler.toml')],{cwd:root,input:token+'\n',encoding:'utf8',timeout:120000,maxBuffer:1024*1024,env:{...process.env,XDG_CONFIG_HOME:join(root,'.tooling/account-config'),WRANGLER_SEND_METRICS:'false'}});
 // Never forward subprocess output or credential values to the terminal.
 if(cli.error||cli.status!==0)throw Error('Cloudflare private secret upload failed; no website values were changed.');
 const updates={KITTY_MEMBERSHIP_BACKEND:backend,KITTY_COMMERCE_GATEWAY_TOKEN:token};
 let result=original;
 for(const [key,value] of Object.entries(updates)){
  const pattern=new RegExp('^'+key+'=.*$','m');
  result=pattern.test(result)?result.replace(pattern,key+'='+value):result.replace(/\s*$/,'')+'\r\n'+key+'='+value+'\r\n';
 }
 if(readFileSync(envFile,'utf8')!==original)throw Error('Website environment changed concurrently; rerun without overwriting it.');
 const temp=envFile+'.commerce-tmp';
 writeFileSync(temp,result,{mode:0o600});renameSync(temp,envFile);
 console.log('PASS matching gateway privately saved to Cloudflare and website local server environment; no values printed.');
 const lookup=async(value)=>fetch(backend+'/api/commerce/order',{method:'POST',headers:{'Content-Type':'application/json','X-Kitty-Commerce-Token':value},body:JSON.stringify({orderId:'order_KittyReadOnlyCheck'}),signal:AbortSignal.timeout(20000),redirect:'error'});
 const denied=await lookup('invalid-gateway-readiness-check');
 const allowed=await lookup(token);
 if(denied.status!==403||allowed.status!==404)throw Error('Live gateway access check failed.');
 console.log('PASS live gateway rejects wrong credentials and accepts the private server credential for a read-only lookup.');
 const catalog=await fetch(backend+'/api/memberships/catalog',{signal:AbortSignal.timeout(20000),redirect:'error'}).then(r=>r.json());
 if(catalog.purchasesEnabled||catalog.plans.some(p=>p.purchasable))throw Error('Checkout unexpectedly enabled; inspect owner configuration.');
 console.log('PASS KITTY/LISA purchases remain disabled; no orders, payments or membership grants created.');
 writeFileSync(join(root,'.tooling/commerce-bridge-status.json'),JSON.stringify({checkedAt:new Date().toISOString(),backend,workerGateway:true,websiteLocalEnvironment:true,wrongCredentialStatus:denied.status,validCredentialReadOnlyStatus:allowed.status,purchasesEnabled:false,hostedWebsiteEnvironmentVerified:false},null,2));
}
main().catch(()=>{console.error('Private bridge setup did not finish. No credential values are logged. Inspect local configuration and rerun safely.');process.exitCode=1;});
