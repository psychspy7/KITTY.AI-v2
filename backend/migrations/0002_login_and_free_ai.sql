CREATE TABLE browser_logins (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  encrypted_credential TEXT,
  uid TEXT
);
CREATE INDEX browser_login_expiry ON browser_logins(expires_at);
CREATE TABLE providers_v2 (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('groq','gemini','cloudflare')), model TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, encrypted_key TEXT NOT NULL);
INSERT INTO providers_v2 SELECT * FROM providers;
DROP TABLE providers;
ALTER TABLE providers_v2 RENAME TO providers;
