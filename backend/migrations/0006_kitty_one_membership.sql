-- Add KITTY ONE as a separate USD annual patron entitlement.
-- Preserve the existing KITTY Plus (INR 99/month) and LISA plan rows unchanged.
ALTER TABLE commerce_plans RENAME TO commerce_plans_legacy;
CREATE TABLE commerce_plans (
  id TEXT PRIMARY KEY,
  product TEXT NOT NULL CHECK(product IN ('kitty','kitty-one','lisa')),
  data TEXT NOT NULL
);
INSERT INTO commerce_plans(id,product,data)
SELECT id,product,data FROM commerce_plans_legacy;
DROP TABLE commerce_plans_legacy;
INSERT INTO commerce_plans(id,product,data) VALUES(
  'kitty-one',
  'kitty-one',
  '{"name":"KITTY ONE","amount":24900,"currency":"USD","months":12,"chatLimit":1,"speechLimit":0,"approved":true,"enabled":true,"benefits":["Annual patron membership supporting KITTY CORP research","Early research updates and quarterly engineering briefings","One free business website (domain and hosting separate)"]}'
);
