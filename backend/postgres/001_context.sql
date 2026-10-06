CREATE SCHEMA IF NOT EXISTS kitty_context;
CREATE TABLE IF NOT EXISTS kitty_context.accounts (
  uid text PRIMARY KEY CHECK(length(uid) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kitty_context.summaries (
  uid text NOT NULL REFERENCES kitty_context.accounts(uid) ON DELETE CASCADE,
  conversation_id text NOT NULL CHECK(length(conversation_id) BETWEEN 1 AND 80),
  revision bigint NOT NULL,
  context jsonb NOT NULL CHECK(jsonb_typeof(context)='object' AND octet_length(context::text)<=4096 AND (context - ARRAY['facts','goals','topic'])='{}'::jsonb),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(uid,conversation_id)
);
CREATE TABLE IF NOT EXISTS kitty_context.memories (
  uid text NOT NULL REFERENCES kitty_context.accounts(uid) ON DELETE CASCADE,
  id text NOT NULL CHECK(length(id) BETWEEN 1 AND 80),
  text text NOT NULL CHECK(length(text) BETWEEN 1 AND 500),
  updated_at bigint NOT NULL,
  PRIMARY KEY(uid,id)
);
ALTER TABLE kitty_context.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitty_context.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE kitty_context.summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitty_context.summaries FORCE ROW LEVEL SECURITY;
ALTER TABLE kitty_context.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitty_context.memories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kitty_uid_scope ON kitty_context.accounts;
CREATE POLICY kitty_uid_scope ON kitty_context.accounts USING(uid=current_setting('kitty.uid',true)) WITH CHECK(uid=current_setting('kitty.uid',true));
DROP POLICY IF EXISTS kitty_uid_scope ON kitty_context.summaries;
CREATE POLICY kitty_uid_scope ON kitty_context.summaries USING(uid=current_setting('kitty.uid',true)) WITH CHECK(uid=current_setting('kitty.uid',true));
DROP POLICY IF EXISTS kitty_uid_scope ON kitty_context.memories;
CREATE POLICY kitty_uid_scope ON kitty_context.memories USING(uid=current_setting('kitty.uid',true)) WITH CHECK(uid=current_setting('kitty.uid',true));
REVOKE ALL ON SCHEMA kitty_context FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA kitty_context FROM PUBLIC;
GRANT USAGE ON SCHEMA kitty_context TO kitty_context_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA kitty_context TO kitty_context_worker;
