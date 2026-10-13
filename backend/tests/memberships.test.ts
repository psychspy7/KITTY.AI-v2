import {beforeAll,afterAll,beforeEach,describe,it,expect} from "vitest";
import {Miniflare} from "miniflare";
import {readFileSync} from "node:fs";
import {membershipRoute,activeMembership,checkChatAccess,calendarRenewal,membershipStatus} from "../src/memberships";
import type {Env,Identity} from "../src/types";
let mf:Miniflare,env:Env;
const owner={uid:"owner",email:"owner@example.test",authTime:1},alice={uid:"alice",email:"a@example.test",authTime:1},bob={uid:"bob",email:"b@example.test",authTime:1};
const gateway="fixture-commerce-token-32-characters-long";
async function call(user:Identity,path:string,method="GET",data?:unknown,token=gateway) {
 return membershipRoute(new Request("https://kitty.example/api/"+path,{method,headers:{"X-Kitty-Commerce-Token":token},body:data?JSON.stringify(data):undefined}),env,"/api/"+path,method,r=>r.json(),async()=>user);
}
const config={enabled:true,liveApproved:false,keyId:"rzp_test_fixture",keySecret:"fixture-test-secret",webhookSecret:"fixture-webhook-secret-long"};
beforeAll(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("OK")}}',d1Databases:["DB"]});
 env={DB:await mf.getD1Database("DB") as unknown as D1Database,OWNER_EMAIL:owner.email,OWNER_UID:owner.uid,VAULT_KEY:btoa("12345678901234567890123456789012"),COMMERCE_GATEWAY_TOKEN:gateway,ALLOW_TEST_MEMBERSHIPS:"true",MEMBERSHIPS_FREE_WINDOW:"enabled",ASSETS:{} as Fetcher,FIREBASE_PROJECT_ID:"fixture",RELEASE_REPOSITORY:"fixture"};
 for(const file of ["0001.sql","0005_memberships.sql"])for(const sql of readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8").split(";").map(x=>x.trim()).filter(Boolean))await env.DB.prepare(sql).run();
});
afterAll(async()=>mf.dispose());
beforeEach(async()=>{
 for(const t of ["commerce_grants","commerce_payments","commerce_webhooks","commerce_orders","commerce_settings","free_chat_windows"])await env.DB.prepare("DELETE FROM "+t).run();
 env.ALLOW_TEST_MEMBERSHIPS="true";
 await env.DB.prepare("UPDATE commerce_plans SET data=json_set(data,'$.enabled',json('false')) WHERE id='kitty-plus'").run();
});
async function ready() {
 await call(owner,"admin/memberships/config","PUT",config);
 await env.DB.prepare("UPDATE commerce_plans SET data=json_set(data,'$.enabled',json('true')) WHERE id='kitty-plus'").run();
}
async function order(user=alice,index=1) {
 const id=crypto.randomUUID();
 const response=await call(user,"commerce/intents","POST",{id,planId:"kitty-plus"});
 expect(response?.status).toBe(200);
 const provider="order_Fixture"+String(index).padStart(6,"0");
 await call(user,"commerce/intents/"+id,"PUT",{orderId:provider,amount:9900,currency:"INR"});
 return {id,provider};
}
const payment=(orderId:string,paymentId="pay_Fixture000001")=>({orderId,paymentId,amount:9900,currency:"INR",captured:true,refunded:0,status:"captured"});
describe("membership ownership and access",()=>{
 it("keeps checkout paused and credentials hidden; requires the exact owner",async()=>{
  await expect(call(alice,"admin/memberships/config","PUT",config)).rejects.toMatchObject({status:403});
  await call(owner,"admin/memberships/config","PUT",{...config,enabled:false});
  const data=await (await call(owner,"admin/memberships/config"))!.text();
  expect(data).not.toContain(config.keySecret);expect(data).not.toContain(config.webhookSecret);expect(data).not.toContain(config.keyId);
  const encrypted=await env.DB.prepare("SELECT data FROM commerce_settings").first<{data:string}>();
  expect(encrypted?.data).not.toContain(config.keySecret);
  await expect(call(alice,"commerce/intents","POST",{id:crypto.randomUUID(),planId:"kitty-plus"})).rejects.toMatchObject({status:503});
 });
 it("rejects live checkout without provider approval and direct access to server credentials",async()=>{
  await expect(call(owner,"admin/memberships/config","PUT",{...config,keyId:"rzp_live_fixture"})).rejects.toMatchObject({status:400});
  await ready();
  await expect(call(alice,"commerce/provider","GET",undefined,"wrong")).rejects.toMatchObject({status:403});
 });
 it("binds an immutable price, product and order to the signed-in user",async()=>{
  await ready();const o=await order();
  await expect(call(bob,"commerce/intents/"+o.id)).rejects.toMatchObject({status:404});
  await expect(call(bob,"commerce/intents","POST",{id:o.id,planId:"kitty-plus"})).rejects.toMatchObject({status:409});
  await expect(call(alice,"commerce/intents/"+o.id,"PUT",{orderId:"order_Changed0001",amount:1,currency:"INR"})).rejects.toMatchObject({status:409});
  await expect(call(alice,"commerce/intents","POST",{id:crypto.randomUUID(),planId:"kitty-plus",amount:1})).rejects.toThrow();
 });
 it("grants only captured payments and handles duplicate callback/webhook delivery once",async()=>{
  await ready();const o=await order();
  await call(alice,"commerce/reconcile","POST",{...payment(o.provider),captured:false,status:"authorized"});
  expect(await activeMembership(env,alice.uid)).toBeNull();
  await call(alice,"commerce/reconcile","POST",{...payment(o.provider),eventId:"event-1"});
  const first=await activeMembership(env,alice.uid);
  for(let i=0;i<3;i++)await call(alice,"commerce/reconcile","POST",{...payment(o.provider),eventId:"event-1"});
  expect(await activeMembership(env,alice.uid)).toEqual(first);
  expect(await activeMembership(env,bob.uid)).toBeNull();
  expect(await activeMembership(env,alice.uid,"lisa")).toBeNull();
  expect((await env.DB.prepare("SELECT COUNT(*) n FROM commerce_grants").first())?.n).toBe(1);
 });
 it("does not turn test payments into production memberships",async()=>{
  await ready();const o=await order();await call(alice,"commerce/reconcile","POST",payment(o.provider));
  env.ALLOW_TEST_MEMBERSHIPS="false";expect(await activeMembership(env,alice.uid)).toBeNull();
 });
 it("reconciles failure/cancellation and a genuine late capture without browser-only access",async()=>{
  await ready();const o=await order();
  await call(alice,"commerce/intents/"+o.id,"DELETE");
  expect(await activeMembership(env,alice.uid)).toBeNull();
  await call(alice,"commerce/reconcile","POST",{...payment(o.provider),status:"failed",captured:false});
  expect(await activeMembership(env,alice.uid)).toBeNull();
  await call(alice,"commerce/reconcile","POST",payment(o.provider));
  expect(await activeMembership(env,alice.uid)).not.toBeNull();
 });
 it("extends renewals once and revokes refunded orders despite stale callbacks",async()=>{
  await ready();const first=await order(alice,1);await call(alice,"commerce/reconcile","POST",payment(first.provider));
  const end=(await activeMembership(env,alice.uid))!.ends_at;
  const next=await order(alice,2);await call(alice,"commerce/reconcile","POST",payment(next.provider,"pay_Fixture000002"));
  const rows=(await env.DB.prepare("SELECT starts_at,ends_at FROM commerce_grants ORDER BY starts_at").all<{starts_at:number;ends_at:number}>()).results;
  expect(rows[1].starts_at).toBe(end);expect(rows[1].ends_at).toBe(calendarRenewal(end,1));
  await call(alice,"commerce/reconcile","POST",{...payment(first.provider),refunded:9900,status:"refunded"});
  await call(alice,"commerce/reconcile","POST",payment(first.provider));
  expect(await activeMembership(env,alice.uid)).toBeNull();
 });
 it("does not report expired or future grants as active",async()=>{
  await ready();const o=await order();await call(alice,"commerce/reconcile","POST",payment(o.provider));
  await env.DB.prepare("UPDATE commerce_grants SET starts_at=?,ends_at=? WHERE order_id=?").bind(Date.now()-10000,Date.now()-1000,o.id).run();
  expect(await activeMembership(env,alice.uid)).toBeNull();
  const expired=await (await call(alice,"commerce/reconcile","POST",payment(o.provider)))!.json() as any;
  expect(expired.active).toBe(false);
  await env.DB.prepare("UPDATE commerce_grants SET starts_at=?,ends_at=? WHERE order_id=?").bind(Date.now()+10000,Date.now()+100000,o.id).run();
  expect(await activeMembership(env,alice.uid)).toBeNull();
  const future=await (await call(alice,"commerce/reconcile","POST",payment(o.provider)))!.json() as any;
  expect(future.active).toBe(false);
 });
 it("enforces expiry, the daily server-clock window and calendar month boundaries",async()=>{
  expect(calendarRenewal(Date.parse("2026-01-31T12:34:00Z"),1)).toBe(Date.parse("2026-02-28T12:34:00Z"));
  await checkChatAccess(env,alice);
  await env.DB.prepare("UPDATE free_chat_windows SET started_at=? WHERE uid=?").bind(Date.now()-301000,alice.uid).run();
  await expect(checkChatAccess(env,alice)).rejects.toMatchObject({status:429,code:"FREE_WINDOW_ENDED"});
  expect((await membershipStatus(env,bob)).freeRemainingSeconds).toBe(300);
  await env.DB.prepare("DELETE FROM free_chat_windows WHERE uid=?").bind(alice.uid).run();
  expect((await membershipStatus(env,alice)).freeRemainingSeconds).toBe(300);
 });
 it("keeps LISA billing separate and rewards disabled",async()=>{
  const catalogue=await (await call(alice,"memberships/catalog"))!.json() as any;
  expect(catalogue.reward.enabled).toBe(false);
  expect(catalogue.plans.find((x:any)=>x.product==="lisa").purchasable).toBe(false);
  await ready();
  await expect(call(alice,"commerce/intents","POST",{id:crypto.randomUUID(),planId:"lisa-premium"})).rejects.toMatchObject({status:503});
 });
});
