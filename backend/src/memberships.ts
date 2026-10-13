import {z} from "zod";
import {ApiError,type Env,type Identity} from "./types";
import {seal,unseal} from "./vault";
import {getConfig} from "./config";
import {isOwner} from "./auth";
const json=(data:unknown)=>Response.json(data,{headers:{"Cache-Control":"private, no-store"}});
const id=z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
export const planSchema=z.object({name:z.string().trim().min(1).max(80),amount:z.number().int().min(100).max(10000000).nullable(),months:z.number().int().min(1).max(12),chatLimit:z.number().int().min(1).max(1000),speechLimit:z.number().int().min(0).max(100),approved:z.boolean(),enabled:z.boolean(),benefits:z.array(z.string().max(180)).max(8)}).strict();
type Order={id:string;uid:string;product:"kitty"|"lisa";plan_id:string;terms:string;mode:"test"|"live";provider_order_id:string|null;provider_key_id:string;status:string;created_at:number;expires_at:number};
type Settings={enabled:boolean;liveApproved:boolean;keyId:string;secret:string;webhook:string;previousWebhook?:string};
const paused=():Settings=>({enabled:false,liveApproved:false,keyId:"",secret:"",webhook:""});
const today=()=>new Date().toISOString().slice(0,10);
export const FREE_SECONDS=300;
export const FEEDBACK_URL="https://kittycorp.vercel.app/contact?subject=Review";
export const MEMBERSHIPS_URL="https://kittycorp.vercel.app/memberships";
async function settings(env:Env):Promise<Settings> {
 const row=await env.DB.prepare("SELECT data FROM commerce_settings WHERE id=1").first<{data:string}>();
 return row?JSON.parse(row.data):paused();
}
const mode=(s:Settings)=>s.keyId.startsWith("rzp_live_")?"live":"test";
function available(s:Settings) {return s.enabled&&!!s.keyId&&!!s.secret&&!!s.webhook&&(mode(s)==="test"||s.liveApproved);}
async function plans(env:Env) {
 const rows=await env.DB.prepare("SELECT id,product,data FROM commerce_plans").all<{id:string;product:string;data:string}>();
 return rows.results.map(x=>({id:x.id,product:x.product,...planSchema.parse(JSON.parse(x.data))}));
}
export function calendarRenewal(base:number,months:number) {
 const date=new Date(base),day=date.getUTCDate();
 date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
 const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
 date.setUTCDate(Math.min(day,last));return date.getTime();
}
async function gateway(request:Request,env:Env) {
 const expected=env.COMMERCE_GATEWAY_TOKEN;
 if(!expected||expected.length<32)throw new ApiError(503,"Membership checkout is not connected yet.");
 const actual=request.headers.get("X-Kitty-Commerce-Token")||"";
 const hash=async(x:string)=>new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(x)));
 const [a,b]=await Promise.all([hash(expected),hash(actual)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 if(diff)throw new ApiError(403,"Commerce access required.");
}
export async function activeMembership(env:Env,uid:string,product="kitty") {
 const kind=env.ALLOW_TEST_MEMBERSHIPS==="true"?"test":"live";
 return env.DB.prepare("SELECT chat_limit,speech_limit,ends_at FROM commerce_grants WHERE uid=? AND product=? AND mode=? AND revoked=0 AND starts_at<=? AND ends_at>? ORDER BY ends_at DESC LIMIT 1").bind(uid,product,kind,Date.now(),Date.now()).first<{chat_limit:number;speech_limit:number;ends_at:number}>();
}
export async function membershipStatus(env:Env,user:Identity) {
 const config=await getConfig(env),s=await settings(env),active=await activeMembership(env,user.uid);
 const window=await env.DB.prepare("SELECT started_at FROM free_chat_windows WHERE uid=? AND day=?").bind(user.uid,today()).first<{started_at:number}>();
 const remaining=window?Math.max(0,Math.ceil((window.started_at+FREE_SECONDS*1000-Date.now())/1000)):FREE_SECONDS;
 return {paid:!!active,expiresAt:active?.ends_at||0,freeRemainingSeconds:remaining,freeStarted:!!window,resetAt:Date.parse(today()+"T00:00:00Z")+86400000,chatLimit:active?.chat_limit||config.dailyChatLimit,speechLimit:active?.speech_limit??config.dailySpeechLimit,membershipAvailable:available(s)&&(await plans(env)).some(p=>p.product==="kitty"&&p.approved&&p.enabled&&p.amount!==null),membershipUrl:MEMBERSHIPS_URL,feedbackUrl:FEEDBACK_URL,priceLabel:"Rs99/month",freeWindowEnabled:env.MEMBERSHIPS_FREE_WINDOW==="enabled",reward:{enabled:false,proposedMessages:5,cooldownDays:30}};
}
export async function checkChatAccess(env:Env,user:Identity) {
 const active=await activeMembership(env,user.uid);
 if(active)return active;
 if(env.MEMBERSHIPS_FREE_WINDOW!=="enabled")return null;
 await env.DB.prepare("INSERT OR IGNORE INTO free_chat_windows VALUES(?,?,?)").bind(user.uid,today(),Date.now()).run();
 const status=await membershipStatus(env,user);
 if(!status.freeRemainingSeconds)throw new ApiError(429,"Your five free minutes for today have ended. They reset at midnight UTC. KITTY Plus is Rs99/month when checkout is available. You can also share honest feedback with KITTY CORP.","FREE_WINDOW_ENDED");
 return null;
}
export async function reconcile(env:Env,input:{orderId:string;paymentId:string;amount:number;currency:string;captured:boolean;refunded:number;status:string;eventId?:string}) {
 const order=await env.DB.prepare("SELECT * FROM commerce_orders WHERE provider_order_id=?").bind(input.orderId).first<Order>();
 if(!order)throw new ApiError(404,"Membership order not found.");
 const terms=planSchema.parse(JSON.parse(order.terms));
 if(input.amount!==terms.amount||input.currency!=="INR")throw new ApiError(409,"Payment does not match this membership order.");
 const previous=await env.DB.prepare("SELECT order_id FROM commerce_payments WHERE payment_id=?").bind(input.paymentId).first<{order_id:string}>();
 if(previous&&previous.order_id!==order.id)throw new ApiError(409,"Payment belongs to another order.");
 const revoked=input.refunded>0||input.status==="refunded";
 const captured=input.status==="captured"&&input.captured&&!revoked;
 await env.DB.prepare("INSERT INTO commerce_payments VALUES(?,?,?,?) ON CONFLICT(payment_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at").bind(input.paymentId,order.id,revoked?"refunded":input.status,Date.now()).run();
 if(revoked)await env.DB.batch([
  env.DB.prepare("UPDATE commerce_orders SET status='refunded' WHERE id=?").bind(order.id),
  env.DB.prepare("UPDATE commerce_grants SET revoked=1 WHERE order_id=?").bind(order.id),
 ]);
 else if(captured&&order.status!=="refunded") {
  await env.DB.prepare("UPDATE commerce_orders SET status='captured' WHERE id=? AND status!='refunded'").bind(order.id).run();
  for(let attempt=0;attempt<5;attempt++) {
   if(await env.DB.prepare("SELECT order_id FROM commerce_grants WHERE order_id=?").bind(order.id).first())break;
   const now=Date.now(),prior=await env.DB.prepare("SELECT MAX(ends_at) ends FROM commerce_grants WHERE uid=? AND product=? AND mode=? AND revoked=0").bind(order.uid,order.product,order.mode).first<{ends:number|null}>();
   const base=Math.max(now,prior?.ends||0),end=calendarRenewal(base,terms.months);
   const inserted=await env.DB.prepare("INSERT OR IGNORE INTO commerce_grants SELECT ?,?,?,?,?,?,?,?,?,0 WHERE COALESCE((SELECT MAX(ends_at) FROM commerce_grants WHERE uid=? AND product=? AND mode=? AND revoked=0),0)=? AND EXISTS(SELECT 1 FROM commerce_orders WHERE id=? AND status='captured') RETURNING order_id").bind(order.id,input.paymentId,order.uid,order.product,order.mode,terms.chatLimit,terms.speechLimit,base,end,order.uid,order.product,order.mode,prior?.ends||0,order.id).first();
   if(inserted)break;
   if(attempt===4)throw new ApiError(503,"Payment received; membership reconciliation is pending. Check status before paying again.");
  }
 } else await env.DB.prepare("UPDATE commerce_orders SET status=? WHERE id=? AND status NOT IN ('captured','refunded')").bind(input.status,order.id).run();
 if(input.eventId)await env.DB.prepare("INSERT OR IGNORE INTO commerce_webhooks VALUES(?,?)").bind(input.eventId,Date.now()).run();
 const grant=await env.DB.prepare("SELECT starts_at,ends_at,revoked FROM commerce_grants WHERE order_id=?").bind(order.id).first<{starts_at:number;ends_at:number;revoked:number}>();
 return {verified:true,paid:captured,active:!!grant&&!grant.revoked&&grant.starts_at<=Date.now()&&grant.ends_at>Date.now(),expiresAt:grant?.ends_at||0,testMode:order.mode==="test",status:revoked?"refunded":input.status};
}
export async function membershipRoute(request:Request,env:Env,path:string,method:string,body:(r:Request)=>Promise<unknown>,authenticate:(r:Request,e:Env)=>Promise<Identity>):Promise<Response|null> {
 if(path==="/api/memberships/catalog"&&method==="GET") {
  const s=await settings(env);
  return json({freeSeconds:FREE_SECONDS,freeResets:"daily UTC",plans:(await plans(env)).map(p=>({...p,purchasable:p.product==="kitty"&&p.enabled&&p.approved&&p.amount!==null&&available(s)})),testMode:mode(s)==="test",purchasesEnabled:available(s),reward:{enabled:false,proposedMessages:5,cooldownDays:30}});
 }
 if(!path.startsWith("/api/commerce/")&&!path.startsWith("/api/admin/memberships")&&path!=="/api/memberships/me")return null;
 if(path.startsWith("/api/admin/")) {
  const user=await authenticate(request,env);if(!isOwner(user,env))throw new ApiError(403,"Owner access required.");
  if(path==="/api/admin/memberships/config"&&method==="GET") {
   const s=await settings(env);return json({enabled:s.enabled,liveApproved:s.liveApproved,mode:mode(s),keyConfigured:!!s.keyId&&!!s.secret,webhookConfigured:!!s.webhook,plans:await plans(env),reward:{enabled:false,proposedMessages:5,cooldownDays:30}});
  }
  if(path==="/api/admin/memberships/config"&&method==="PUT") {
   const value=z.object({enabled:z.boolean(),liveApproved:z.boolean(),keyId:z.string().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/).optional(),keySecret:z.string().min(8).max(500).optional(),webhookSecret:z.string().min(16).max(500).optional()}).strict().parse(await body(request));
   const old=await settings(env),next:Settings={...old,enabled:value.enabled,liveApproved:value.liveApproved};
   if(value.keyId)next.keyId=value.keyId;
   if(value.keySecret)next.secret=await seal(value.keySecret,env.VAULT_KEY,"commerce:razorpay");
   if(value.webhookSecret) {
    if(old.webhook)next.previousWebhook=old.webhook;
    next.webhook=await seal(value.webhookSecret,env.VAULT_KEY,"commerce:webhook");
   }
   if(value.keyId&&value.keyId!==old.keyId&&!value.keySecret)throw new ApiError(400,"Supply the matching secret when changing the key ID.");
   if(next.enabled&&!available(next))throw new ApiError(400,"Configure keys and a webhook secret; live mode also requires Razorpay approval.");
   await env.DB.prepare("INSERT INTO commerce_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(next)).run();
   return json({saved:true});
  }
  if(path==="/api/admin/memberships/config"&&method==="DELETE") {
   await env.DB.prepare("DELETE FROM commerce_settings WHERE id=1").run();return json({deleted:true});
  }
  if(path==="/api/admin/memberships/plans"&&method==="PUT") {
   const input=z.object({id,product:z.enum(["kitty","lisa"]),plan:planSchema}).strict().parse(await body(request));
   if(input.plan.enabled&&(!input.plan.approved||input.plan.amount===null))throw new ApiError(400,"Approve the price and limits before enabling a plan.");
   if(input.product==="lisa"&&input.plan.enabled)throw new ApiError(400,"LISA access enforcement must be integrated before purchases can be enabled.");
   const existingProduct=await env.DB.prepare("SELECT product FROM commerce_plans WHERE id=?").bind(input.id).first<{product:string}>();
   if(existingProduct&&existingProduct.product!==input.product)throw new ApiError(409,"A plan cannot be moved to a different product.");
   await env.DB.prepare("INSERT INTO commerce_plans VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE commerce_plans.product=excluded.product").bind(input.id,input.product,JSON.stringify(input.plan)).run();return json({saved:true});
  }
  if(path==="/api/admin/memberships/orders"&&method==="GET")return json((await env.DB.prepare("SELECT id,uid,product,plan_id,provider_order_id,status,created_at FROM commerce_orders ORDER BY created_at DESC LIMIT 100").all()).results);
  throw new ApiError(404,"Membership operation not found.");
 }
 if(path==="/api/memberships/me"&&method==="GET")return json(await membershipStatus(env,await authenticate(request,env)));
 await gateway(request,env);
 if(path==="/api/commerce/provider"&&method==="GET") {
  const s=await settings(env);
  if(!s.keyId||!s.secret||!s.webhook)throw new ApiError(503,"Membership payments are not configured.");
  return json({keyId:s.keyId,keySecret:await unseal(s.secret,env.VAULT_KEY,"commerce:razorpay"),webhookSecret:await unseal(s.webhook,env.VAULT_KEY,"commerce:webhook"),previousWebhookSecret:s.previousWebhook?await unseal(s.previousWebhook,env.VAULT_KEY,"commerce:webhook"):undefined,testMode:mode(s)==="test",enabled:available(s)});
 }
 if(path==="/api/commerce/reconcile"&&method==="POST") {
  const input=z.object({orderId:z.string().regex(/^order_[A-Za-z0-9]{6,64}$/),paymentId:z.string().regex(/^pay_[A-Za-z0-9]{6,64}$/),amount:z.number().int().positive(),currency:z.literal("INR"),captured:z.boolean(),refunded:z.number().int().min(0),status:z.enum(["created","authorized","captured","failed","refunded"]),eventId:z.string().max(100).optional()}).strict().parse(await body(request));
  return json(await reconcile(env,input));
 }
 if(path==="/api/commerce/order"&&method==="POST") {
  const input=z.object({orderId:z.string().regex(/^order_[A-Za-z0-9]{6,64}$/)}).strict().parse(await body(request));
  const row=await env.DB.prepare("SELECT * FROM commerce_orders WHERE provider_order_id=?").bind(input.orderId).first<Order>();
  if(!row)throw new ApiError(404,"Membership order not found.");
  return json({id:row.id,terms:JSON.parse(row.terms),keyId:row.provider_key_id,mode:row.mode});
 }
 const user=await authenticate(request,env);
 const disabled=await env.DB.prepare("SELECT disabled FROM profiles WHERE uid=?").bind(user.uid).first<{disabled:number}>();
 if(disabled?.disabled)throw new ApiError(403,"Account paused.");
 if(path==="/api/commerce/intents"&&method==="POST") {
  const input=z.object({id:z.string().uuid(),planId:id}).strict().parse(await body(request));
  const s=await settings(env),plan=(await plans(env)).find(p=>p.id===input.planId);
  if(!available(s)||!plan?.approved||!plan.enabled||plan.amount===null)throw new ApiError(503,"Membership purchases are not available yet.");
  if(plan.product!=="kitty")throw new ApiError(503,"LISA memberships are not available yet.");
  const existing=await env.DB.prepare("SELECT * FROM commerce_orders WHERE id=?").bind(input.id).first<Order>();
  if(existing) {
   if(existing.uid!==user.uid||existing.plan_id!==plan.id)throw new ApiError(409,"Checkout belongs to another account or plan.");
   return json({...existing,terms:JSON.parse(existing.terms)});
  }
  const count=await env.DB.prepare("SELECT COUNT(*) n FROM commerce_orders WHERE uid=? AND created_at>?").bind(user.uid,Date.now()-3600000).first<{n:number}>();
  if((count?.n||0)>=10)throw new ApiError(429,"Too many checkout attempts. Please try later.");
  const {id:planId,product,...terms}=plan;
  await env.DB.prepare("INSERT INTO commerce_orders VALUES(?,?,?,?,?,?,NULL,?,'created',?,?)").bind(input.id,user.uid,product,planId,JSON.stringify(terms),mode(s),s.keyId,Date.now(),Date.now()+3600000).run();
  return json({id:input.id,uid:user.uid,product,plan_id:planId,terms,mode:mode(s),provider_key_id:s.keyId,status:"created"});
 }
 const intent=path.match(/^\/api\/commerce\/intents\/([a-f0-9-]{36})$/);
 if(intent) {
  const row=await env.DB.prepare("SELECT * FROM commerce_orders WHERE id=? AND uid=?").bind(intent[1],user.uid).first<Order>();
  if(!row)throw new ApiError(404,"Checkout not found.");
  if(method==="GET")return json({...row,terms:JSON.parse(row.terms)});
  if(method==="PUT") {
   const input=z.object({orderId:z.string().regex(/^order_[A-Za-z0-9]{6,64}$/),amount:z.number().int(),currency:z.literal("INR")}).strict().parse(await body(request));
   const terms=planSchema.parse(JSON.parse(row.terms));
   if(input.amount!==terms.amount||row.expires_at<Date.now())throw new ApiError(409,"Checkout expired or amount changed.");
   await env.DB.prepare("UPDATE commerce_orders SET provider_order_id=? WHERE id=? AND uid=? AND provider_order_id IS NULL").bind(input.orderId,row.id,user.uid).run();
   const saved=await env.DB.prepare("SELECT provider_order_id FROM commerce_orders WHERE id=?").bind(row.id).first<{provider_order_id:string}>();
   if(saved?.provider_order_id!==input.orderId)throw new ApiError(409,"This checkout already has a different order.");
   return json({saved:true});
  }
  if(method==="DELETE") {
   await env.DB.prepare("UPDATE commerce_orders SET status='cancelled' WHERE id=? AND uid=? AND status='created'").bind(row.id,user.uid).run();return json({cancelled:true});
  }
 }
 throw new ApiError(404,"Membership operation not found.");
}
