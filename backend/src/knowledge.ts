import {ApiError,type Env,type Identity} from './types';
import {isOwner} from './auth';
const cache=new Map<string,{expires:number,text:string}>();
const stop=new Set('the and for are was were this that with from about explain please could would tell what when where which how why you your into have does did do should help me my mean means also first many much more very something anything please useful tell explain'.split(' '));
export function knowledgeTerms(text:string):string[]{
 if(/https?:|@|\b\d{8,}\b/.test(text)||/\b(latest|today|current|medical|diagnos|legal|investment|stock price)\b/i.test(text))return [];
 return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9]{2,30}/g)||[]).filter(x=>!stop.has(x)))].slice(0,8);
}
export function formatReferences(rows:any[],terms:string[]):string {
 const snippets:string[]=[];let budget=3200;
 const expanded:any[]=[];
 for(const row of rows.slice(0,4)){
  const f=row.document?.fields;if(f?.published?.booleanValue!==true)continue;
  try { const entries=JSON.parse(f.content?.stringValue||""); if(Array.isArray(entries)){for(const e of entries.slice(0,16))expanded.push({document:{fields:{published:{booleanValue:true},title:{stringValue:e.title},source:{stringValue:e.source},content:{stringValue:e.content}}}});continue;} }catch{}
  expanded.push(row);
 }
 expanded.sort((a,b)=>terms.filter(t=>(b.document.fields.content.stringValue||"").toLowerCase().includes(t)).length-terms.filter(t=>(a.document.fields.content.stringValue||"").toLowerCase().includes(t)).length);
 for(const row of expanded){
  const f=row.document?.fields;if(f?.published?.booleanValue!==true)continue;
  const title=f.title?.stringValue,source=f.source?.stringValue,content=f.content?.stringValue;
  if(typeof title!=='string'||typeof content!=='string'||!/^https:\/\/en\.wikipedia\.org\/wiki\//.test(source))continue;
  const paragraphs=content.split('\n').filter((p:string)=>p.trim()).map((p:string)=>({p,score:terms.filter(t=>p.toLowerCase().includes(t)).length})).sort((a:any,b:any)=>b.score-a.score);
  if(!paragraphs[0]?.score)continue;
  const excerpt=paragraphs.slice(0,2).map((x:any)=>x.p).join('\n').slice(0,Math.min(950,budget));
  const item=JSON.stringify({title:title.slice(0,180),url:source,excerpt,snapshot:'Historical WikiText-103; verify present-day facts',licence:'CC-BY-SA-3.0, Wikipedia contributors; adapted'});
  if(item.length>budget)continue;snippets.push(item);budget-=item.length;
 }
 return snippets.join('\n');
}
export async function knowledgeContext(request:Request,env:Env,text:string):Promise<string>{
 if(env.KNOWLEDGE_ENABLED!=='true'||request.signal.aborted)return '';
 const terms=knowledgeTerms(text);if(!terms.length)return '';
 const key=[...terms].sort().join('|'),saved=cache.get(key);if(saved&&saved.expires>Date.now())return saved.text;
 try{
  const r=await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`,{method:'POST',headers:{Authorization:request.headers.get('Authorization')||'','Content-Type':'application/json'},signal:AbortSignal.any([request.signal,AbortSignal.timeout(2500)]),body:JSON.stringify({structuredQuery:{from:[{collectionId:'kitty_library'}],where:{compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:'published'},op:'EQUAL',value:{booleanValue:true}}},{fieldFilter:{field:{fieldPath:'keywords'},op:'ARRAY_CONTAINS_ANY',value:{arrayValue:{values:terms.map(t=>({stringValue:t}))}}}}]}},limit:4}})});
  if(!r.ok)return '';const rows=await r.json() as any[];const result=formatReferences(rows,terms);
  if(cache.size>=32)cache.delete(cache.keys().next().value!);cache.set(key,{expires:Date.now()+300000,text:result});return result;
 }catch{return '';}
}
export async function knowledgeAdmin(request:Request,env:Env,user:Identity){
 if(!isOwner(user,env))throw new ApiError(403,'Owner access required.');
 const r=await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/kitty_library_meta/current`,{headers:{Authorization:request.headers.get('Authorization')||''},signal:AbortSignal.timeout(5000)});
 if(!r.ok)return Response.json({enabled:env.KNOWLEDGE_ENABLED==='true',ready:false},{headers:{'Cache-Control':'no-store'}});
 const d=await r.json() as any;const f=d.fields||{};
 return Response.json({enabled:env.KNOWLEDGE_ENABLED==='true',ready:true,contentBytes:Number(f.contentBytes?.integerValue||0),documents:Number(f.documents?.integerValue||0),source:f.source?.stringValue,license:f.license?.stringValue,preparedAt:f.preparedAt?.stringValue,fineTuned:false},{headers:{'Cache-Control':'no-store'}});
}
