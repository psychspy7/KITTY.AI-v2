import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const origin='https://kitty-ai-v2.kitty-ai.workers.dev';
const gateway=JSON.parse(readFileSync(join(root,'.tooling/secrets/commerce-gateway.json'),'utf8')).token;
const env={...process.env,XDG_CONFIG_HOME:join(root,'.tooling/account-config'),WRANGLER_SEND_METRICS:'false'};
function cli(args){const r=spawnSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),...args,'--config',join(root,'backend/wrangler.toml')],{cwd:root,env,encoding:'utf8',timeout:90000,maxBuffer:2e6});if(r.error||r.status!==0)throw Error('Private database operation failed');return args.includes('--file')?null:JSON.parse(r.stdout)[0].results;}
const query=sql=>cli(['d1','execute','kitty-db','--remote','--command',sql,'--json']);
const quote=x=>"'"+x.replaceAll("'","''")+"'";
async function provider(){const r=await fetch(origin+'/api/commerce/provider',{headers:{'X-Kitty-Commerce-Token':gateway},signal:AbortSignal.timeout(20000),redirect:'error'});if(r.status!==200)throw Error('Provider not configured');return r.json();}
async function catalog(){return fetch(origin+'/api/memberships/catalog',{signal:AbortSignal.timeout(20000),redirect:'error'}).then(r=>r.json());}
async function main(){
 const readiness=JSON.parse(readFileSync(join(root,'.tooling/membership-provider-status.json'),'utf8'));
 if(!readiness.vaultBackupVerified||!readiness.livePairVerified||!readiness.merchantWebhookVerified||!readiness.providerVaultLiveVerified||!readiness.webhookConfigured||Date.now()-Date.parse(readiness.checkedAt)>86400000)throw Error('Private readiness checks missing or stale');
 const p=await provider();if(p.testMode||!p.keyId.startsWith('rzp_live_'))throw Error('Live provider required');
 const raw=JSON.stringify({event:'kitty.readiness',payload:{}});
 const hookUrl='https://kittycorp.vercel.app/api/memberships/webhook';
 const request=signature=>fetch(hookUrl,{method:'POST',headers:{'Content-Type':'application/json','X-Razorpay-Signature':signature},body:raw,signal:AbortSignal.timeout(20000),redirect:'error'});
 const denied=await request('0'.repeat(64));const accepted=await request(createHmac('sha256',p.webhookSecret).update(raw).digest('hex'));
 if(denied.status!==400||accepted.status!==200||(await accepted.json()).ignored!==true)throw Error('Hosted webhook authentication failed');
 console.log('PASS hosted webhook rejects an invalid signature and accepts a signed non-payment readiness event; no payment or grant created.');
 const settingsText=query('SELECT data FROM commerce_settings WHERE id=1')[0]?.data;
 const planRow=query("SELECT product,data FROM commerce_plans WHERE id='kitty-plus'")[0];
 if(!settingsText||!planRow)throw Error('Configured plan missing');
 const settings=JSON.parse(settingsText),plan=JSON.parse(planRow.data);
 if(settings.keyId!==p.keyId||!settings.secret||!settings.webhook||planRow.product!=='kitty'||!plan.approved||plan.amount!==9900||plan.months!==1||plan.chatLimit!==100||plan.speechLimit!==10)throw Error('Plan/configuration differs from approved finite terms');
 const before=await catalog();if(before.plans.some(x=>x.product==='lisa'&&x.purchasable)||before.reward.enabled)throw Error('Separate product/reward gate changed');
 if(!process.argv.includes('--activate')){console.log('PASS activation preflight; no switches changed.');return;}
 const file=join(root,'.tooling/secrets/membership-activation.sql');
 const sql=`UPDATE commerce_settings SET data=json_set(data,'$.liveApproved',json('true'),'$.enabled',json('true')) WHERE id=1 AND data=${quote(settingsText)};\nUPDATE commerce_plans SET data=json_set(data,'$.enabled',json('true')) WHERE id='kitty-plus' AND product='kitty' AND data=${quote(planRow.data)} AND EXISTS(SELECT 1 FROM commerce_settings WHERE id=1 AND json_extract(data,'$.enabled')=1 AND json_extract(data,'$.liveApproved')=1);`;
 try{writeFileSync(file,sql,{mode:0o600});cli(['d1','execute','kitty-db','--remote','--file',file,'--json']);}finally{unlinkSync(file);}
 const after=await catalog(),live=await provider();const kitty=after.plans.find(x=>x.id==='kitty-plus');
 if(!after.purchasesEnabled||after.testMode||!live.enabled||live.testMode||!kitty?.purchasable||kitty.amount!==9900||kitty.months!==1||kitty.chatLimit!==100||kitty.speechLimit!==10||after.plans.some(x=>x.product==='lisa'&&x.purchasable)||after.reward.enabled)throw Error('Post-activation verification failed; inspect owner controls immediately');
 const status={checkedAt:new Date().toISOString(),purchasesEnabled:true,testMode:false,plan:'kitty-plus',amountMinor:9900,currency:'INR',months:1,chatLimit:100,speechLimit:10,lisaPurchasable:false,rewardsEnabled:false,hostedWebhookSignatureCheck:true,realPurchaseTested:false,freshPhoneTested:false};
 writeFileSync(join(root,'.tooling/membership-activation-status.json'),JSON.stringify(status,null,2));console.log(JSON.stringify(status));
}
main().catch(()=>{console.error('Membership activation stopped; no secret values logged. Inspect private readiness and current owner controls.');process.exitCode=1;});
