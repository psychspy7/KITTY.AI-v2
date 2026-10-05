import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, signOut, setPersistence, browserSessionPersistence } from "firebase/auth";
import "./style.css";
const app = document.querySelector<HTMLDivElement>("#app")!;
const id = new URL(location.href).searchParams.get("session");
app.innerHTML = `<div class="login"><img src="/kitty-icon.png" alt="KITTY"><span class="eyebrow">KITTY / SECURE SIGN-IN</span><h1>Let’s get you in.</h1><p>This signs the KITTY app into your Google account.<br>Continue only if you opened this page from KITTY on your phone.</p><button id="login" class="primary" disabled>Sign in with Google</button><p id="status" role="status">Connecting…</p><a id="return" href="kittyai://login/complete" hidden>Return to KITTY</a><small>Created by Virat with the help of Kitty Corp.</small></div>`;
const button = document.querySelector<HTMLButtonElement>("#login")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const back = document.querySelector<HTMLAnchorElement>("#return")!;
async function setup() {
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Open browser sign-in from the KITTY app first.");
  const config = await fetch("/firebase-config.json").then(r => r.json());
  const auth = getAuth(initializeApp(config));
  await setPersistence(auth, browserSessionPersistence);
  status.textContent = "Choose the account you want to use in KITTY.";
  button.disabled = false;
  async function complete(result: import("firebase/auth").UserCredential) {
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.idToken) throw new Error("Google did not return a sign-in credential. Please try again.");
    const response = await fetch("https://kitty-ai-v2.kitty-ai.workers.dev/api/login/browser/complete", {
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${await result.user.getIdToken()}`},
      body:JSON.stringify({id,googleIdToken:credential.idToken}),signal:AbortSignal.timeout(30000),
    });
    const body=await response.json();
    if (!response.ok) throw new Error(body.error || "Sign-in could not finish. Please try again.");
    status.textContent=`Signed in as ${result.user.email}. Return to KITTY to continue.`;
    button.hidden=true;
    back.hidden=false;
    await signOut(auth);
  }
  const redirected = await getRedirectResult(auth);
  if (redirected) { await complete(redirected); return }
  button.onclick = async () => {
    button.disabled = true;
    status.textContent = "Waiting for Google…";
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithRedirect(auth, provider);
    } catch (error) {
      status.textContent = (error as Error).message;
      button.disabled = false;
    }
  };
}
void setup().catch(error => { status.textContent = error.message; });
