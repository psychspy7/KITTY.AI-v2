export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  FIREBASE_PROJECT_ID: string;
  OWNER_EMAIL: string;
  OWNER_UID?: string;
  VAULT_KEY?: string;
  FIREBASE_WEB_API_KEY?: string;
  RELEASE_REPOSITORY: string;
  GOOGLE_WEB_CLIENT_ID?: string;
  AI?: Ai;
}
export interface Identity {
  uid: string;
  email: string;
  authTime: number;
}
export interface Provider {
  id: string;
  kind: "groq" | "gemini" | "cloudflare" | "elevenlabs" | "fish";
  model: string;
  enabled: number;
  encrypted_key: string;
}
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
