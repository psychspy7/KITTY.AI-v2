CREATE TABLE providers_v3 (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('groq','gemini','cloudflare','elevenlabs','fish')), model TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, encrypted_key TEXT NOT NULL);
INSERT INTO providers_v3 SELECT * FROM providers;
DROP TABLE providers;
ALTER TABLE providers_v3 RENAME TO providers;
CREATE TABLE provider_checks (provider_id TEXT NOT NULL, mode TEXT NOT NULL, tested_at INTEGER NOT NULL, ok INTEGER NOT NULL, model TEXT NOT NULL, duration_ms INTEGER NOT NULL, error TEXT NOT NULL DEFAULT '', error_type TEXT NOT NULL DEFAULT '', PRIMARY KEY(provider_id,mode));
