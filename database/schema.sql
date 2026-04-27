CREATE TABLE IF NOT EXISTS source (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT,
  url TEXT,
  file_path TEXT,
  author TEXT,
  publisher TEXT,
  year INTEGER,
  language TEXT,
  reliability_level TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS ingestion_task (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  input_uri TEXT,
  input_text TEXT,
  file_path TEXT,
  status TEXT NOT NULL,
  content_type TEXT,
  source_id TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS document_chunk (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  chunk_index INTEGER,
  raw_text TEXT,
  clean_text TEXT,
  summary TEXT,
  page_start INTEGER,
  page_end INTEGER,
  embedding_id TEXT,
  created_at TEXT,
  FOREIGN KEY(source_id) REFERENCES source(id)
);

CREATE TABLE IF NOT EXISTS entity (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT,
  description TEXT,
  tcm_explanation TEXT,
  western_explanation TEXT,
  confidence REAL,
  source_count INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS relation (
  id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  evidence_text TEXT,
  source_id TEXT,
  confidence REAL,
  review_status TEXT,
  created_at TEXT,
  FOREIGN KEY(from_entity_id) REFERENCES entity(id),
  FOREIGN KEY(to_entity_id) REFERENCES entity(id),
  FOREIGN KEY(source_id) REFERENCES source(id)
);

CREATE TABLE IF NOT EXISTS case_record (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  title TEXT,
  patient_info TEXT,
  chief_complaint TEXT,
  symptoms TEXT,
  tongue_pulse TEXT,
  diagnosis_tcm TEXT,
  diagnosis_western TEXT,
  formula_used TEXT,
  herbs_used TEXT,
  outcome TEXT,
  clinical_takeaway TEXT,
  created_at TEXT,
  FOREIGN KEY(source_id) REFERENCES source(id)
);

CREATE TABLE IF NOT EXISTS review_item (
  id TEXT PRIMARY KEY,
  target_type TEXT,
  target_id TEXT,
  review_level TEXT,
  review_reason TEXT,
  risk_flags TEXT,
  decision TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS flashcard (
  id TEXT PRIMARY KEY,
  card_type TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  related_entity_ids TEXT,
  source_id TEXT,
  difficulty INTEGER,
  review_count INTEGER DEFAULT 0,
  next_review_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_model_config (
  id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model_name TEXT NOT NULL,
  api_type TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
