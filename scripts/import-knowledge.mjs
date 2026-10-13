import {readFileSync,writeFileSync,createReadStream} from 'node:fs';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {createInterface} from 'node:readline';
const root=fileURLToPath(new URL('../',import.meta.url)),folder=join(root,'.tooling/knowledge');process.env.XDG_CONFIG_HOME=join(root,'.tooling/account-config');
const require=createRequire(import.meta.url),cli=join(process.env.APPDATA,'npm/node_modules/firebase-tools');
const auth=require(join(cli,'lib/auth.js')),{requireAuth}=require(join(cli,'lib/requireAuth.js')),{Client}=require(join(cli,'lib/apiv2.js'));
const project='kittyai-f743c';const account=auth.getGlobalDefaultAccount();if(account?.user?.email!=='viratanand1221@gmail.com')throw Error('Exact owner CLI session required');
await requireAuth({project,nonInteractive:true,user:account.user,tokens:account.tokens});
const api=new Client({urlPrefix:'https://firestore.googleapis.com',auth:true});const base=`projects/${project}/databases/(default)/documents`;
const manifest=JSON.parse(readFileSync(join(folder,'manifest.json'),'utf8'));
if(manifest.documents>18000||manifest.contentBytes>500000000)throw Error('Reserved free quota exceeded; refuse paid import');
function value(x){if(typeof x==='boolean')return{booleanValue:x};if(typeof x==='number')return{integerValue:String(x)};if(Array.isArray(x))return{arrayValue:{values:x.map(value)}};return{stringValue:String(x)}}
try {
 const current=(await api.get(`/v1/${base}/kitty_library_meta/current`,{skipLog:{body:true,resBody:true}})).body.fields;
 if(current.revision?.stringValue===manifest.revision && Number(current.contentBytes?.integerValue)===manifest.contentBytes && Number(current.documents?.integerValue)===manifest.documents){writeFileSync(join(root,'knowledge/manifest.json'),JSON.stringify({...manifest,uploadedAt:current.uploadedAt?.stringValue,database:'(default)',region:'asia-south1'},null,2));console.log('Identical published library already exists; no duplicate import.');process.exit(0);}
 throw Error('Another library exists; review replacement and remaining free quota first.');
}catch(e){if(e.message==='Another library exists; review replacement and remaining free quota first.')throw e;}
const progressFile=join(folder,'upload-progress.json');let completed=0;try{const progress=JSON.parse(readFileSync(progressFile,'utf8'));if(progress.revision===manifest.revision)completed=progress.completed}catch{}
let index=0,batch=[],batchStart=completed,lastLogged=completed;
const pending=new Set(),done=new Map();
async function commit(){
 if(!batch.length)return;const writes=batch,start=batchStart,end=index;batch=[];batchStart=index;
 const job=(async()=>{
  await api.post(`/v1/${base}:commit`,{writes},{skipLog:{body:true,resBody:true}});
  done.set(start,end);while(done.has(completed)){const next=done.get(completed);done.delete(completed);completed=next;}
  writeFileSync(progressFile,JSON.stringify({completed,revision:manifest.revision}));
  if(completed-lastLogged>=400){lastLogged=completed;console.log(`Imported ${completed}/${manifest.documents} public chunks; no user chats included.`);}
 })();pending.add(job);job.then(()=>pending.delete(job),()=>pending.delete(job));
 if(pending.size>=3)await Promise.race(pending);
}
for await(const line of createInterface({input:createReadStream(join(folder,'documents.jsonl'),{encoding:'utf8'}),crlfDelay:Infinity})){
 index++;if(index<=batchStart && index<=completed)continue;
 // Acknowledge only a contiguous prefix: interrupted imports can safely resume.
 if(index<=completed)continue;
 const d=JSON.parse(line),id=d.id;delete d.id;
 batch.push({update:{name:`${base}/kitty_library/${id}`,fields:Object.fromEntries(Object.entries(d).map(([k,v])=>[k,value(v)]))}});
 if(batch.length===100)await commit();
}
await commit();await Promise.all(pending);
await api.post(`/v1/${base}:commit`,{writes:[{update:{name:`${base}/kitty_library_meta/current`,fields:Object.fromEntries(Object.entries({...manifest,uploadedAt:new Date().toISOString()}).map(([k,v])=>[k,value(v)]))}}]},{skipLog:{body:true,resBody:true}});
writeFileSync(join(root,'knowledge/manifest.json'),JSON.stringify({...manifest,uploadedAt:new Date().toISOString(),database:'(default)',region:'asia-south1'},null,2));console.log(`PASS Firebase import complete: ${index} documents, ${manifest.contentBytes} reference bytes. No billing change or fine-tuning.`);
