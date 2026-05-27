CREATE TABLE IF NOT EXISTS saves (
  player TEXT NOT NULL,
  slot TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (player, slot)
);

CREATE INDEX IF NOT EXISTS saves_updated_idx ON saves(updated_at DESC);
