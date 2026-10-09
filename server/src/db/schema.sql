CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claimant TEXT NOT NULL,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  description TEXT NOT NULL,
  receipt_available INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','under_review','approved','rejected','clarification_requested')),
  final_category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS validation_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  check_name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','error')),
  message TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  status TEXT NOT NULL CHECK (status IN ('ok','unavailable','invalid_output')),
  category TEXT,
  confidence REAL,
  uncertain INTEGER,
  verdict TEXT CHECK (verdict IN ('comply','needs_clarification','needs_review')),
  explanation TEXT,
  cited_sections_json TEXT,
  questions_json TEXT,
  model TEXT,
  prompt_version TEXT,
  latency_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  reviewer TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve','reject','request_clarification','override_category')),
  reason TEXT,
  override_category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (action NOT IN ('reject','request_clarification','override_category') OR length(trim(coalesce(reason,''))) > 0),
  CHECK (action != 'override_category' OR override_category IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER REFERENCES claims(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
