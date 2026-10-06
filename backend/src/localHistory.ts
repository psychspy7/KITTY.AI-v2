import { z } from "zod";
import { ApiError, type Env, type Identity } from "./types";
import { digest, replyProof, verifyReply } from "./replyProof";

const id=z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
const json=(value:unknown)=>Response.json(value,{headers:{"Cache-Control":"no-store"}});
export async function localHistoryRoute(request:Request,env:Env,user:Identity,path:string,method:string,body:(request:Request)=>Promise<unknown>):Promise<Response|null> {
  if((path==="/api/conversations"||/^\/api\/conversations\/[a-zA-Z0-9-]+$/.test(path))&&method==="GET")throw new ApiError(426,"Update KITTY to 1.7 to keep chat history on your device.");
  if(path==="/api/reply/ack"&&method==="POST") {
    const input=z.object({requestId:id}).strict().parse(await body(request));
    await env.DB.prepare("UPDATE requests SET response='' WHERE uid=? AND id=? AND status='complete'").bind(user.uid,input.requestId).run();
    return json({saved:true});
  }
  if(path==="/api/history/export"&&method==="GET") {
    const params=new URL(request.url).searchParams;
    const offset=z.coerce.number().int().min(0).max(100000).parse(params.get("offset")||0);
    let saved=await env.DB.prepare("SELECT token,cutoff,expires_at FROM history_exports WHERE uid=?").bind(user.uid).first<{token:string;cutoff:number;expires_at:number}>();
    const migrated=await env.DB.prepare("SELECT local_history FROM profiles WHERE uid=?").bind(user.uid).first<{local_history:number}>();
    if(migrated?.local_history)return json({token:"",conversations:[],messages:[],next:null,complete:true});
    if(!saved||saved.expires_at<Date.now()) {
      if(offset!==0)throw new ApiError(409,"History transfer expired. Retry sync.");
      saved={token:crypto.randomUUID(),cutoff:Date.now(),expires_at:Date.now()+3600000};
      await env.DB.prepare("INSERT INTO history_exports VALUES(?,?,?,?) ON CONFLICT(uid) DO UPDATE SET token=excluded.token,cutoff=excluded.cutoff,expires_at=excluded.expires_at").bind(user.uid,saved.token,saved.cutoff,saved.expires_at).run();
    }
    if(offset>0&&params.get("token")!==saved.token)throw new ApiError(409,"History transfer changed. Retry sync.");
    const conversations=(await env.DB.prepare("SELECT id,title,updated_at FROM conversations WHERE uid=? ORDER BY updated_at DESC LIMIT 200").bind(user.uid).all()).results;
    const rows=(await env.DB.prepare("SELECT m.*,(SELECT u.text FROM messages u WHERE u.uid=m.uid AND u.request_id=m.request_id AND u.role='user') AS question FROM messages m WHERE m.uid=? AND m.created_at<=? ORDER BY m.created_at,m.id LIMIT 100 OFFSET ?").bind(user.uid,saved.cutoff,offset).all<Record<string,unknown>>()).results;
    const messages=await Promise.all(rows.map(async ({question,uid,...m})=>({...m,...(m.role==="assistant"&&m.status==="complete"&&typeof question==="string"?await replyProof(env,user.uid,String(m.id),question,String(m.text)):{})})));
    return json({token:saved.token,conversations:offset===0?conversations:[],messages,next:rows.length===100?offset+100:null,complete:false});
  }
  if(path==="/api/history/ack"&&method==="POST") {
    const input=z.object({token:z.string().uuid()}).strict().parse(await body(request));
    const saved=await env.DB.prepare("SELECT cutoff FROM history_exports WHERE uid=? AND token=? AND expires_at>?").bind(user.uid,input.token,Date.now()).first<{cutoff:number}>();
    if(!saved)throw new ApiError(409,"History transfer expired. Retry sync before clearing cloud history.");
    // Only already-consented, individually selected examples survive history migration.
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO shared_examples SELECT e.uid,e.message_id,m.conversation_id,COALESCE((SELECT u.text FROM messages u WHERE u.uid=m.uid AND u.request_id=m.request_id AND u.role='user'),''),m.text,e.created_at FROM examples e JOIN profiles p ON p.uid=e.uid AND p.consent=1 JOIN messages m ON m.uid=e.uid AND m.id=e.message_id WHERE e.uid=? AND m.status='complete' AND m.created_at<=?").bind(user.uid,saved.cutoff),
      env.DB.prepare("DELETE FROM messages WHERE uid=? AND created_at<=?").bind(user.uid,saved.cutoff),
      env.DB.prepare("DELETE FROM conversations WHERE uid=? AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.uid=? AND m.conversation_id=conversations.id)").bind(user.uid,user.uid),
      env.DB.prepare("DELETE FROM requests WHERE uid=? AND updated_at<=? AND status!='running'").bind(user.uid,saved.cutoff),
      env.DB.prepare("INSERT INTO profiles(uid,local_history) VALUES(?,1) ON CONFLICT(uid) DO UPDATE SET local_history=1").bind(user.uid),
      env.DB.prepare("DELETE FROM history_exports WHERE uid=? AND token=?").bind(user.uid,input.token),
    ]);
    return json({saved:true});
  }
  if(path==="/api/examples"&&method==="POST") {
    const input=z.object({messageId:id,conversationId:id,question:z.string().min(1).max(8000),text:z.string().min(1).max(32000),questionHash:z.string().length(64),proof:z.string().max(100)}).strict().parse(await body(request));
    const profile=await env.DB.prepare("SELECT consent FROM profiles WHERE uid=?").bind(user.uid).first<{consent:number}>();
    if(!profile?.consent)throw new ApiError(403,"Enable example-sharing consent in Settings first.");
    if(await digest(input.question)!==input.questionHash||!await verifyReply(env,user.uid,input.messageId,input.questionHash,input.text,input.proof))throw new ApiError(403,"This example could not be verified.");
    await env.DB.prepare("INSERT OR IGNORE INTO shared_examples VALUES(?,?,?,?,?,?)").bind(user.uid,input.messageId,input.conversationId,input.question,input.text,Date.now()).run();
    return json({shared:true});
  }
  return null;
}
