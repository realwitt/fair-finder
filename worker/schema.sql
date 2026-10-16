-- Fair Finder anonymous counts. Hashes only; rows are purged by the hourly cron.
CREATE TABLE IF NOT EXISTS visits (
  day TEXT NOT NULL,
  booth TEXT NOT NULL,
  dev TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (day, booth, dev)
);
CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits (ts);

CREATE TABLE IF NOT EXISTS searches (
  day TEXT NOT NULL,
  k TEXT NOT NULL,
  dev TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (day, k, dev)
);
CREATE INDEX IF NOT EXISTS idx_searches_ts ON searches (ts);

CREATE TABLE IF NOT EXISTS ratelimit (
  ipk TEXT NOT NULL,
  win INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (ipk, win)
);

CREATE TABLE IF NOT EXISTS booths (
  id TEXT PRIMARY KEY
);
