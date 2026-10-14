import {Miniflare} from "miniflare";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
beforeEach(()=>vi.resetModules());afterEach(()=>vi.unstubAllGlobals());
const html=(text="KITTY CORP publishes information about its software and development.")=>new Response(`<html><script>privateScript</script><main><h1>Public products</h1><p>${text}</p></main></html>`,{headers:{"Content-Type":"text/html; charset=utf-8"}});
const request=()=>new Request("https://kitty.test/chat",{headers:{Authorization:"Bearer PRIVATE_USER_TOKEN"}});
describe("public Kitty Corp integration",()=>{
 it("reads visible main content and excludes scripts, forms, comments and page chrome",async()=>{
  const {publicPageText}=await import("../src/corpContext");
  expect(publicPageText(`<head><script><main>decoy</main></script></head><nav>chrome</nav><main><!-- hidden --><style>hiddenCss</style>Public &amp; honest &#x1f431;<form><textarea>privateForm</textarea></form><script>privateKey</script></main>`)).toBe("Public & honest 🐱");
  expect(()=>publicPageText("<h1>Sign in</h1>")).toThrow();
 });
 it("does not fetch company pages for unrelated chat but retains the shared public directory",async()=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);const {corpContext,corpPrompt}=await import("../src/corpContext");
  expect(await corpContext(request(),"Explain gravity",true)).toBe("");expect(fetch).not.toHaveBeenCalled();
  expect(corpPrompt("")).toContain("LISA AI");expect(corpPrompt("")).toContain("SecretChat");expect(corpPrompt("")).toContain("no tools");
 });
 it("fetches only fixed public pages, never forwards private queries/tokens, and caches public facts",async()=>{
  const fetch=vi.fn().mockImplementation(()=>Promise.resolve(html()));vi.stubGlobal("fetch",fetch);
  const {corpContext}=await import("../src/corpContext");const q="Tell me about LISA and KITTY CORP; private-person@example.com";
  const facts=await corpContext(request(),q,true);expect(facts).toContain("/lisa-ai");expect(facts).not.toContain("private-person");
  expect(fetch.mock.calls.map(([url])=>url)).toEqual(["https://kittycorp.vercel.app/company","https://kittycorp.vercel.app/lisa-ai"]);
  for(const [,options] of fetch.mock.calls){expect(options.redirect).toBe("manual");expect(options.headers).toEqual({Accept:"text/html"});expect(options.body).toBeUndefined();}
  await corpContext(request(),q,true);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it("keeps multilingual reference text inside the prompt byte budget",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockImplementation(()=>Promise.resolve(html("猫".repeat(6000)))));
  const {corpContext}=await import("../src/corpContext");expect(new TextEncoder().encode(await corpContext(request(),"KITTY CORP",true)).length).toBeLessThan(3500);
 });
 it("fails open and backs off when public pages redirect or become unavailable",async()=>{
  const fetch=vi.fn().mockImplementation(()=>Promise.resolve(new Response("secret",{status:302,headers:{Location:"https://untrusted.example"}})));vi.stubGlobal("fetch",fetch);
  const {corpContext}=await import("../src/corpContext");const result=await corpContext(request(),"KITTY CORP",true);
  expect(JSON.parse(result).publicPages).toEqual([]);expect(result).not.toContain("secret");await corpContext(request(),"KITTY CORP",true);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it("rejects oversized pages without retaining arbitrary upstream content",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockImplementation(()=>Promise.resolve(html("x".repeat(300000)))));
  const {corpContext}=await import("../src/corpContext");expect(JSON.parse(await corpContext(request(),"KITTY CORP",true)).publicPages).toEqual([]);
 });
 it("does not start public fetch work after request cancellation",async()=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);const abort=new AbortController();abort.abort();
  const {corpContext}=await import("../src/corpContext");expect(await corpContext(new Request("https://kitty.test",{signal:abort.signal}),"KITTY CORP",true)).toBe("");expect(fetch).not.toHaveBeenCalled();
 });
 it("exposes only the public catalogue across origins with no account or database access",async()=>{
  const {route}=await import("../src/index");const verify=vi.fn(),db=vi.fn();
  const env={CORP_CONTEXT_ENABLED:"false",DB:{prepare:db}} as any;
  const result=await route(new Request("https://kitty.test/api/corp?source=https://untrusted.example",{headers:{Origin:"https://another-product.test"}}),env,{} as any,verify);
  expect(result.status).toBe(200);expect(result.headers.get("Access-Control-Allow-Origin")).toBe("*");
  const data=await result.json() as any;expect(data.products.map((p:any)=>p.id)).toEqual(["kitty-ai","lisa-ai","secretchat","sentinel"]);expect(data.publicPages).toEqual([]);
  expect(verify).not.toHaveBeenCalled();expect(db).not.toHaveBeenCalled();
  expect((await route(new Request("https://kitty.test/api/corp",{method:"POST"}),env,{} as any,verify)).status).toBe(405);
 });
});

it("loads the public catalogue in actual workerd with the production compatibility date",async()=>{
  const source=readFileSync(new URL("../src/corpContext.ts",import.meta.url),"utf8");
  const script=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^export /gm,"")+"\nexport default {async fetch(r){return Response.json(await corpCatalogue(r,true));}};";
  const urls:string[]=[];
  const mf=new Miniflare({modules:true,script,compatibilityDate:"2025-09-01",compatibilityFlags:["nodejs_compat"],outboundService:async(request)=>{
    urls.push(request.url);expect(request.headers.get("Authorization")).toBeNull();
    return html("KITTY CORP publishes public product information about LISA AI and SecretChat.");
  }});
  try{const response=await mf.dispatchFetch("https://kitty.test/api/corp");expect(response.status).toBe(200);const c=await response.json() as any;expect(c.publicPages).toHaveLength(5);expect(c.publicPagesSync).toBe("available");expect(urls).toContain("https://kittycorp.vercel.app/company");}finally{await mf.dispose();}
});
