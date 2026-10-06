ALTER TABLE profiles ADD COLUMN local_history INTEGER NOT NULL DEFAULT 0 CHECK(local_history IN (0,1));
CREATE TABLE context_cache (uid TEXT NOT NULL, conversation_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL CHECK(length(data)<=4096), PRIMARY KEY(uid,conversation_id));
CREATE TABLE shared_examples (uid TEXT NOT NULL, message_id TEXT NOT NULL, conversation_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(uid,message_id));
CREATE TABLE history_exports (uid TEXT PRIMARY KEY, token TEXT NOT NULL, cutoff INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE context_jobs (uid TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(uid,kind,id));
CREATE TABLE context_tombstones (uid TEXT NOT NULL, conversation_id TEXT NOT NULL, deleted_at INTEGER NOT NULL, PRIMARY KEY(uid,conversation_id));
