import { ApiError, type Env } from "./types";

export async function digest(text:string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function signingKey(env:Env) {
  if(!env.VAULT_KEY)throw new ApiError(503,"Reply verification is unavailable.");
  return crypto.subtle.importKey("raw",Uint8Array.from(atob(env.VAULT_KEY),c=>c.charCodeAt(0)),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
const payload=(uid:string,id:string,questionHash:string,answerHash:string)=>new TextEncoder().encode(JSON.stringify(["kitty-reply-v1",uid,id,questionHash,answerHash]));
export async function replyProof(env:Env,uid:string,id:string,question:string,answer:string) {
  const questionHash=await digest(question),answerHash=await digest(answer);
  const signature=new Uint8Array(await crypto.subtle.sign("HMAC",await signingKey(env),payload(uid,id,questionHash,answerHash)));
  return {questionHash,proof:btoa(String.fromCharCode(...signature))};
}
export async function verifyReply(env:Env,uid:string,id:string,questionHash:string,answer:string,proof:string) {
  try {
    if(!/^[a-f0-9]{64}$/.test(questionHash)||proof.length>100)return false;
    return await crypto.subtle.verify("HMAC",await signingKey(env),Uint8Array.from(atob(proof),c=>c.charCodeAt(0)),payload(uid,id,questionHash,await digest(answer)));
  } catch{return false;}
}
