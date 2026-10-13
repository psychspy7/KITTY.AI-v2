import {readFileSync,writeFileSync,unlinkSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {webcrypto,createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const website=join(root,'../KITTY CORP STARTUP WEBSITE');
const cliEnv={...process.env,XDG_CONFIG_HOME:join(root,'.tooling/account-config'),WRANGLER_SEND_METRICS:'false'};
const env=Object.fromEntries(readFileSync(join(website,'.env.local'),'utf8').split(/\r?\n/).filter(x=>/^[A-Z0-9_]+=/.test(x)).map(x=>{const n=x.indexOf('=');return[x.slice(0,n),x.slice(n+1).trim().replace(/^['"]|['"]$/g,'')]}));
let stage='read-only checks';
function cli(args){const r=spawnSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),...args,'--config',join(root,'backend/wrangler.toml')],{cwd:root,env:cliEnv,encoding:'utf8',timeout:90000,maxBuffer:2e6});if(r.error||r.status!==0){console.error('Private CLI exit status: '+r.status+'; timeout: '+(r.error?.code==='ETIMEDOUT'));throw Error('Private CLI operation failed')}if(args.includes('--file'))return null;try{return JSON.parse(r.stdout)}catch{console.error('Private CLI completed but returned a non-JSON response.');throw Error('Private CLI response failed')}}
function query(sql){return cli(['d1','execute','kitty-db','--remote','--command',sql,'--json'])[0].results;}
const quote=x=>"'"+x.replaceAll("'","''")+"'";
async function main(){
 const keyBytes=Buffer.from(readFileSync(join(root,'backend/.vault-key.local'),'utf8').trim(),'base64');
 if(keyBytes.length!==32)throw Error('Invalid backup');
 const key=await webcrypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt','decrypt']);
 const open=async(value,label)=>{const[iv,data]=value.split('.');return new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64'),additionalData:new TextEncoder().encode(label)},key,Buffer.from(data,'base64')))};
 const seal=async(value,label)=>{const iv=webcrypto.getRandomValues(new Uint8Array(12));const data=await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(label)},key,new TextEncoder().encode(value));return Buffer.from(iv).toString('base64')+'.'+Buffer.from(data).toString('base64')};
 const samples=query("SELECT id,encrypted_key FROM providers WHERE encrypted_key!='' LIMIT 1");
 if(!samples.length||!(await open(samples[0].encrypted_key,samples[0].id)))throw Error('Vault verification failed');
 console.log('PASS retained vault backup decrypts an existing live provider record; no vault rotation or bootstrap endpoint needed.');
 stage='website encrypted runtime';
 const supabase=new URL(env.SUPABASE_URL);if(supabase.protocol!=='https:'||!supabase.hostname.endsWith('.supabase.co'))throw Error('Unexpected runtime origin');
 const rpc=await fetch(new URL('/rest/v1/rpc/kitty_website_runtime_configuration',supabase),{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_gateway_token:env.FEEDBACK_GATEWAY_TOKEN}),signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!rpc.ok)throw Error('Runtime read failed');
 const envelope=JSON.parse(await rpc.json());if(envelope.v!==1||!/^[a-f0-9]{24}$/.test(envelope.iv)||!/^[a-f0-9]+$/.test(envelope.data))throw Error('Invalid envelope');
 const runtimeKey=await webcrypto.subtle.importKey('raw',createHash('sha256').update(env.FEEDBACK_GATEWAY_TOKEN+':kitty-runtime-v1').digest(),'AES-GCM',false,['decrypt']);
 const runtime=JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'hex'),additionalData:new TextEncoder().encode('kitty-runtime-v1')},runtimeKey,Buffer.from(envelope.data,'hex'))));
 const keyId=runtime.RAZORPAY_KEY_ID,keySecret=runtime.RAZORPAY_KEY_SECRET;
 if(!/^rzp_live_[A-Za-z0-9]+$/.test(keyId)||typeof keySecret!=='string'||keySecret.length<8)throw Error('Live pair unavailable');
 stage='provider read-only authentication';
 const provider=await fetch('https://api.razorpay.com/v1/orders?count=1',{headers:{Authorization:'Basic '+Buffer.from(keyId+':'+keySecret).toString('base64')},signal:AbortSignal.timeout(20000),redirect:'error'});
 if(provider.status!==200)throw Error('Live pair rejected');
 console.log('PASS existing LIVE Razorpay key pair authenticated through a read-only request; no order or charge created.');
 const rows=query('SELECT data FROM commerce_settings WHERE id=1');const oldText=rows[0]?.data;const old=oldText?JSON.parse(oldText):{enabled:false,liveApproved:false,keyId:'',secret:'',webhook:''};
 if(old.keyId&&old.keyId!==keyId)throw Error('Existing membership provider differs; do not replace pending-order credentials');
 const existingKeyVerified=!!old.secret&&old.keyId===keyId&&await open(old.secret,'commerce:razorpay')===keySecret;
 console.log('Existing encrypted membership key verified: '+existingKeyVerified+'; checkout paused: '+!old.enabled);
 const next={...old,enabled:false,keyId,secret:existingKeyVerified?old.secret:await seal(keySecret,'commerce:razorpay')};
 const handoff=join(root,'.tooling/secrets/membership-webhook.json');
 const encryptedHandoff=join(website,'work/private-membership-webhook.json');
 let webhookSecret,merchantWebhookVerified=false;
 if(existsSync(encryptedHandoff)){
  stage='separate encrypted webhook handoff';
  const h=JSON.parse(readFileSync(encryptedHandoff,'utf8'));
  if(h.url!=='https://kittycorp.vercel.app/api/memberships/webhook'||typeof h.webhookId!=='string')throw Error('Invalid membership endpoint');
  const e=typeof h.ciphertext==='string'?JSON.parse(h.ciphertext):h.ciphertext;
  if(e.v!==1||!/^[a-f0-9]{24}$/.test(e.iv)||!/^[a-f0-9]+$/.test(e.data)||e.data.length>24000)throw Error('Invalid private handoff envelope');
  const privateData=JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(e.iv,'hex'),additionalData:new TextEncoder().encode('kitty-runtime-v1')},runtimeKey,Buffer.from(e.data,'hex'))));
  webhookSecret=privateData.RAZORPAY_WEBHOOK_SECRET;
  const hooks=await fetch('https://api.razorpay.com/v1/webhooks?count=100',{headers:{Authorization:'Basic '+Buffer.from(keyId+':'+keySecret).toString('base64')},signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!hooks.ok)throw Error('Merchant webhook verification failed');
  const list=await hooks.json();const hook=list.items?.find(x=>x.id===h.webhookId);
  const events=['payment.authorized','payment.captured','payment.failed','order.paid','refund.processed'];
  if(!hook||hook.url!==h.url||!hook.active||!events.every(event=>Array.isArray(hook.events)?hook.events.includes(event):!!hook.events?.[event]))throw Error('Separate membership webhook is not active with required events');
  merchantWebhookVerified=true;
  console.log('PASS separate merchant membership webhook active with required events; service webhook not modified.');
 } else if(existsSync(handoff)){
  const h=JSON.parse(readFileSync(handoff,'utf8'));if(h.url!=='https://kittycorp.vercel.app/api/memberships/webhook')throw Error('Invalid separate webhook handoff');webhookSecret=h.secret;
 }
 if(webhookSecret!==undefined){
  if(typeof webhookSecret!=='string'||webhookSecret.length<16)throw Error('Invalid matching webhook secret');
  if(old.webhook&&await open(old.webhook,'commerce:webhook')!==webhookSecret)throw Error('Existing membership webhook differs; rotation requires review');
  next.webhook=old.webhook||await seal(webhookSecret,'commerce:webhook');
 }
 if(process.argv.includes('--apply')){
  stage='encrypted provider save';const sqlFile=join(root,'.tooling/secrets/membership-provider.sql');mkdirSync(join(root,'.tooling/secrets'),{recursive:true});
  const nextText=JSON.stringify(next);
  const sql=oldText?`UPDATE commerce_settings SET data=${quote(nextText)} WHERE id=1 AND data=${quote(oldText)};`:`INSERT INTO commerce_settings(id,data) VALUES(1,${quote(nextText)});`;
  try{if(nextText!==oldText){writeFileSync(sqlFile,sql,{mode:0o600});cli(['d1','execute','kitty-db','--remote','--file',sqlFile,'--json']);}}finally{if(existsSync(sqlFile))unlinkSync(sqlFile)}
  const saved=JSON.parse(query('SELECT data FROM commerce_settings WHERE id=1')[0].data);
  if(saved.enabled||saved.keyId!==keyId||await open(saved.secret,'commerce:razorpay')!==keySecret)throw Error('Saved settings verification failed');
  if(next.webhook&&(saved.webhook!==next.webhook||webhookSecret&&await open(saved.webhook,'commerce:webhook')!==webhookSecret))throw Error('Webhook verification failed');
  console.log('PASS encrypted membership provider saved and read back; checkout remains disabled.');
 }
 const catalog=await fetch('https://kitty-ai-v2.kitty-ai.workers.dev/api/memberships/catalog',{signal:AbortSignal.timeout(20000)}).then(r=>r.json());if(catalog.purchasesEnabled||catalog.plans.some(p=>p.purchasable))throw Error('Checkout unexpectedly enabled');
 let providerVaultLiveVerified=false;
 if(process.argv.includes('--apply')&&next.webhook){
  const token=JSON.parse(readFileSync(join(root,'.tooling/secrets/commerce-gateway.json'),'utf8')).token;
  const check=await fetch('https://kitty-ai-v2.kitty-ai.workers.dev/api/commerce/provider',{headers:{'X-Kitty-Commerce-Token':token},signal:AbortSignal.timeout(20000),redirect:'error'});
  if(check.status!==200)throw Error('Live vault verification failed');
  const remote=await check.json();
  if(remote.keyId!==keyId||remote.keySecret!==keySecret||remote.webhookSecret!==webhookSecret||remote.enabled!==false)throw Error('Live vault values do not match private setup');
  providerVaultLiveVerified=true;console.log('PASS live Worker decrypts matching provider and webhook values for the authenticated server gateway; checkout remains paused.');
 }
 const status={checkedAt:new Date().toISOString(),vaultBackupVerified:true,livePairVerified:true,applied:process.argv.includes('--apply'),existingKeyVerified,merchantWebhookVerified,providerVaultLiveVerified,webhookConfigured:!!next.webhook,purchasesEnabled:false,bootstrapNeeded:false};
 writeFileSync(join(root,'.tooling/membership-provider-status.json'),JSON.stringify(status,null,2));console.log(JSON.stringify(status));
}
main().catch(()=>{console.error('Private setup stopped during '+stage+'. No credentials are logged.');process.exitCode=1});
