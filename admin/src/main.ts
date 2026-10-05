import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  inMemoryPersistence,
  type User,
} from "firebase/auth";
import "./style.css";
const app = document.querySelector<HTMLDivElement>("#app")!;
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let user: User | null = null,
  section = "overview";
let config: any,
  providers: any[] = [];
const firebaseConfig = await fetch("/firebase-config.json").then((r) =>
  r.json(),
);
const auth = getAuth(initializeApp(firebaseConfig));
await setPersistence(auth, inMemoryPersistence);
async function api(path: string, method = "GET", data?: unknown) {
  if (!user) throw new Error("Sign in first.");
  const response = await fetch(`/api/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}
function notify(message: string, error = false) {
  const box = document.querySelector("#status");
  if (box) {
    box.textContent = message;
    box.className = error ? "status error" : "status";
  }
}
function field(label: string, id: string, value: unknown, type = "text") {
  return `<label>${escape(label)}<input id="${id}" type="${type}" value="${escape(value)}"></label>`;
}
function shell(content: string) {
  app.innerHTML = `<aside><a class="brand" href="/"><img src="/kitty-icon.png" alt="KITTY"><span>KITTY<span class="brand-sub">CONTROL ROOM</span></span></a><div class="nav-label">WORKSPACE</div><nav>${["overview", "providers", "personality", "limits", "announcements", "updates", "examples"].map((n) => `<button data-section="${n}" class="${section === n ? "active" : ""}">${n[0].toUpperCase() + n.slice(1)}</button>`).join("")}</nav><div class="aside-footer"><span class="live-dot"></span> Owner session<br><small>${escape(user?.email)}</small><button id="logout">Sign out</button></div></aside><main><header><span class="eyebrow">KITTY CORP / ADMIN</span><span class="badge">PRIVATE</span></header><div id="status" class="status" role="status"></div>${content}<footer>Created by Virat with the help of Kitty Corp. Keys stay on the backend.</footer></main>`;
  document.querySelectorAll<HTMLButtonElement>("[data-section]").forEach(
    (b) =>
      (b.onclick = () => {
        section = b.dataset.section!;
        void load().catch((e) => notify(e.message, true));
      }),
  );
  document.querySelector<HTMLButtonElement>("#logout")!.onclick = () =>
    void signOut(auth);
}
function title(name: string, subtitle: string) {
  return `<div class="heading"><h1>${name}</h1><p>${subtitle}</p></div>`;
}
const value = (id: string) =>
  (document.getElementById(id) as HTMLInputElement).value;
function submit(id: string, action: () => Promise<void>) {
  document.getElementById(id)!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector<HTMLButtonElement>(
      `#${id} button[type=submit]`,
    )!;
    button.disabled = true;
    try {
      await action();
      notify("Saved successfully.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      button.disabled = false;
    }
  });
}
async function saveConfig() {
  await api("admin/config", "PUT", config);
}
async function load() {
  config = await api("admin/config");
  providers = await api("admin/providers");
  if (section === "overview") {
    shell(
      title(
        "A little wit. A lot of control.",
        "Your companion, your rules. Everything KITTY needs lives here.",
      ) +
        `<div class="hero"><div><span class="eyebrow">SERVICE STATUS</span><h2>${config.enabled ? "Ready for conversation." : "Taking a little catnap."}</h2><p>${config.enabled ? "KITTY is available to signed-in users." : "Configure a provider, then bring KITTY online."}</p><button id="toggle" class="primary">${config.enabled ? "Pause service" : "Enable service"}</button></div><img src="/kitty-icon.png" alt="KITTY emblem"></div><div class="cards"><article><span class="eyebrow">CHAT PROVIDERS</span><h2>${providers.filter((p) => p.enabled).length}</h2><p>Keys are encrypted. Saved values are never returned.</p></article><article><span class="eyebrow">DAILY CHAT LIMIT</span><h2>${config.dailyChatLimit}</h2><p>Per user · resets at midnight UTC</p></article><article><span class="eyebrow">SPEECH</span><h2>Gemini</h2><p>${escape(config.speechModel)}</p></article></div><article><h3>Secure owner activation</h3><p>Your verified Firebase UID:</p><code>${escape(user?.uid)}</code><p>Backend access requires this exact UID, the owner email, and a verified Google session.</p></article>`,
    );
    document.getElementById("toggle")!.onclick = async () => {
      try {
        config.enabled = !config.enabled;
        await saveConfig();
        await load();
      } catch (e) {
        notify((e as Error).message, true);
      }
    };
  } else if (section === "providers") {
    shell(
      title(
        "The engine room.",
        "Add Groq for chat and Gemini for speech. Users never see a key.",
      ) +
        `<div class="two-col"><article><h3>Configured providers</h3>${providers.map((p) => `<div class="provider"><div><strong>${escape(p.id)}</strong><p>${escape(p.kind)} / ${escape(p.model)}</p><small>Key configured · ${p.enabled ? "enabled" : "paused"}</small></div><button data-models="${escape(p.id)}">Models</button><button data-delete="${escape(p.id)}" class="danger">Remove</button></div>`).join("") || "<p>No providers yet.</p>"}<pre id="models"></pre></article><article><h3>Add or update a provider</h3><form id="provider-form">${field("ID (groq-main, groq-fast or gemini-speech)", "provider-id", "groq-main")}<label>Provider<select id="kind"><option value="groq">Groq</option><option value="gemini">Gemini</option></select></label>${field("Chat model", "model", "openai/gpt-oss-120b")}${field("API key · leave blank to preserve an existing key", "key", "", "password")}<label class="check"><input type="checkbox" id="provider-enabled" checked>Enabled</label><button class="primary" type="submit">Save provider</button></form></article></div><article><form id="routing">${field("Ordered chat provider IDs, separated by commas", "order", config.chatProviders.join(","))}${field("Speech provider ID", "speech-provider", config.speechProvider)}${field("Gemini TTS model", "speech-model", config.speechModel)}${field("Voice", "voice", config.speechVoice)}<p>Fallbacks apply before the first text arrives. A partial reply is never silently replaced.</p><button type="submit" class="primary">Save routing</button></form></article>`,
    );
    submit("provider-form", async () => {
      await api("admin/providers", "PUT", {
        id: value("provider-id"),
        kind: value("kind"),
        model: value("model"),
        enabled: (
          document.getElementById("provider-enabled") as HTMLInputElement
        ).checked,
        ...(value("key") ? { key: value("key") } : {}),
      });
      (document.getElementById("key") as HTMLInputElement).value = "";
      await load();
    });
    submit("routing", async () => {
      config.chatProviders = value("order")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      config.speechProvider = value("speech-provider");
      config.speechModel = value("speech-model");
      config.speechVoice = value("voice");
      await saveConfig();
    });
    document.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (!confirm(`Remove ${b.dataset.delete}?`)) return;
          try {
            await api(`admin/providers/${b.dataset.delete}`, "DELETE");
            await load();
          } catch (e) {
            notify((e as Error).message, true);
          }
        }),
    );
    document.querySelectorAll<HTMLButtonElement>("[data-models]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            document.getElementById("models")!.textContent = (
              await api(`admin/models?provider=${b.dataset.models}`)
            ).join("\n");
          } catch (e) {
            notify((e as Error).message, true);
          }
        }),
    );
  } else if (section === "personality") {
    shell(
      title(
        "The voice behind the wit.",
        "Only the verified owner can change KITTY’s core identity.",
      ) +
        `<article><form id="personality">${field("Creator attribution", "creator", config.creator)}<label>Core personality<textarea id="prompt" rows="17">${escape(config.corePrompt)}</textarea></label><button type="submit" class="primary">Save personality</button></form></article>`,
    );
    submit("personality", async () => {
      config.creator = value("creator");
      config.corePrompt = value("prompt");
      await saveConfig();
    });
  } else if (section === "limits") {
    shell(
      title(
        "Keep things comfortably in bounds.",
        "Usage controls are enforced on the backend.",
      ) +
        `<div class="two-col"><article><form id="limits">${field("Chats per user per day", "chat-limit", config.dailyChatLimit, "number")}${field("Speech plays per user per day", "speech-limit", config.dailySpeechLimit, "number")}${field("Chats across all users per day", "global-limit", config.globalDailyChatLimit, "number")}${field("Maximum output tokens", "tokens", config.maxOutputTokens, "number")}<button type="submit" class="primary">Save limits</button></form></article><article><h3>Individual user</h3><form id="user-limits">${field("Exact user Firebase UID", "uid", "")}${field("Daily chat override (blank = default)", "user-limit", "", "number")}<label class="check"><input type="checkbox" id="disabled">Pause this user</label><button type="submit" class="primary">Save user</button></form><p>Provider requests, including failed attempts and retries, consume allowance.</p></article></div>`,
    );
    submit("limits", async () => {
      config.dailyChatLimit = Number(value("chat-limit"));
      config.dailySpeechLimit = Number(value("speech-limit"));
      config.globalDailyChatLimit = Number(value("global-limit"));
      config.maxOutputTokens = Number(value("tokens"));
      await saveConfig();
    });
    submit("user-limits", async () => {
      await api("admin/users", "PUT", {
        uid: value("uid"),
        disabled: (document.getElementById("disabled") as HTMLInputElement)
          .checked,
        dailyLimit: value("user-limit") ? Number(value("user-limit")) : null,
      });
    });
  } else if (section === "announcements") {
    const notices = await api("announcements");
    shell(
      title(
        "Something to say?",
        "Announcements appear in the in-app Inbox. This release does not send background push notifications.",
      ) +
        `<article><form id="notice">${field("Title", "notice-title", "")}<label>Announcement<textarea id="notice-body" rows="5"></textarea></label><button type="submit" class="primary">Publish announcement</button></form></article><article>${notices.map((n: any) => `<div class="provider"><div><h3>${escape(n.title)}</h3><p>${escape(n.body)}</p></div><button data-notice="${escape(n.id)}" class="danger">Remove</button></div>`).join("") || "<p>Your Inbox is quiet.</p>"}</article>`,
    );
    submit("notice", async () => {
      await api("admin/announcements", "POST", {
        title: value("notice-title"),
        body: value("notice-body"),
      });
      await load();
    });
    document.querySelectorAll<HTMLButtonElement>("[data-notice]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            await api(`admin/announcements/${b.dataset.notice}`, "DELETE");
            await load();
          } catch (e) {
            notify((e as Error).message, true);
          }
        }),
    );
  } else if (section === "updates") {
    shell(
      title(
        "The next chapter.",
        "Publish owner-signed APKs through psychspy7/KITTY.AI-v2 GitHub Releases.",
      ) +
        `<article><form id="release">${field("Version code (must increase)", "version-code", config.release.versionCode, "number")}${field("Version name", "version-name", config.release.versionName)}${field("Direct GitHub Release APK URL", "url", config.release.url)}${field("APK SHA-256 checksum", "sha256", config.release.sha256 || "")}<label>Release notes<textarea id="notes" rows="5">${escape(config.release.notes)}</textarea></label><button type="submit" class="primary">Publish update information</button></form><p>Android verifies signing continuity when a downloaded update is installed.</p></article>`,
    );
    submit("release", async () => {
      config.release = {
        versionCode: Number(value("version-code")),
        versionName: value("version-name"),
        url: value("url"),
        sha256: value("sha256").trim().toLowerCase(),
        notes: value("notes"),
      };
      await saveConfig();
    });
  } else {
    const examples = await api("admin/examples");
    shell(
      title(
        "Learn with permission.",
        "Only explicitly shared examples from users with active consent appear. Reviewing or saving these does not fine-tune a model.",
      ) +
        `<article>${examples.map((e: any) => `<div class="example"><span class="eyebrow">SHARED EXAMPLE / ${escape(new Date(e.created_at).toLocaleDateString())}</span><h3>${escape(e.question)}</h3><p>${escape(e.answer)}</p></div>`).join("") || "<p>No eligible examples have been shared.</p>"}</article>`,
    );
  }
}
function login() {
  app.innerHTML = `<div class="login"><img src="/kitty-icon.png" alt="KITTY"><span class="eyebrow">KITTY / CONTROL ROOM</span><h1>Good to see you, Sir.</h1><p>A companion with character.<br>A control room with boundaries.</p><button id="login" class="primary">Sign in with Google</button><p id="login-error" role="alert"></p><small>Owner: viratanand1221@gmail.com</small></div>`;
  document.getElementById("login")!.onclick = () => {
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    void signInWithPopup(auth, p).catch((e) => {
      document.getElementById("login-error")!.textContent = e.message;
    });
  };
}
onAuthStateChanged(auth, async (next) => {
  user = next;
  if (!user) {
    login();
    return;
  }
  try {
    const me = await api("me");
    if (!me.admin) {
      app.innerHTML = `<div class="login"><h1>${me.activationPending ? "One secure step remains." : "Owner access required."}</h1><p>${me.activationPending ? "Configure this verified UID as the backend OWNER_UID secret:" : "This account does not have administrator access."}</p>${me.activationPending ? `<code>${escape(me.uid)}</code>` : ""}<button id="exit">Sign out</button></div>`;
      document.getElementById("exit")!.onclick = () => void signOut(auth);
      return;
    }
    await load();
  } catch (e) {
    shell(
      title(
        "Connection needs attention.",
        "Check Firebase and backend configuration.",
      ),
    );
    notify((e as Error).message, true);
  }
});
