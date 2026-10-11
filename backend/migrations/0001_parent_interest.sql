-- Parent/guardian contact details only. No child profiles, names, or free-text notes.
CREATE TABLE IF NOT EXISTS parent_interest (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT UNIQUE NOT NULL,
  request_fingerprint TEXT NOT NULL,
  received_at TEXT NOT NULL,
  parent_name TEXT NOT NULL CHECK(length(parent_name) BETWEEN 1 AND 120),
  email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
  phone TEXT NOT NULL DEFAULT '' CHECK(length(phone) <= 32),
  interest TEXT NOT NULL CHECK(interest IN ('interested', 'questions')),
  consent_at TEXT NOT NULL,
  consent_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS parent_interest_received_at ON parent_interest(received_at, id);
