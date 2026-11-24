-- Plootos: every table of spec 4.5.
-- Amounts in integer cents; months 'YYYY-MM'; dates 'YYYY-MM-DD'; timestamps in UTC (ISO 8601).
-- Authors (created_by, updated_by) are the address read from the verified Access token.
-- Nothing is erased: archiving or removing sets a date. The Worker checks the business rules
-- (spec 4.3); the database checks shapes, links and uniqueness.
-- Ids are plain INTEGER PRIMARY KEY (no AUTOINCREMENT): nothing is deleted, and a restore
-- inserts the ids of the export.
-- Texts are bounded (names 200 characters, labels and comments 500): the read builds its answer
-- in chunks of rows, each far below D1's limit of 2 MB per string.

CREATE TABLE section (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 200),
  -- Chosen at creation, never changed: 'in' (income) or 'out' (expense).
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sort_order INTEGER NOT NULL CHECK (typeof(sort_order) = 'integer'),
  archived_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Category (level 1: section_id set) or subcategory (level 2: parent_id set).
CREATE TABLE category (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 200),
  parent_id INTEGER REFERENCES category (id),
  section_id INTEGER REFERENCES section (id),
  sort_order INTEGER NOT NULL CHECK (typeof(sort_order) = 'integer'),
  archived_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((parent_id IS NULL) <> (section_id IS NULL))
);
CREATE INDEX category_parent ON category (parent_id);

-- Its row_version also goes up on every write to its versions and overrides (spec 4.3).
CREATE TABLE budget_line (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0 AND length(label) <= 200),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE budget_line_version (
  id INTEGER PRIMARY KEY,
  budget_line_id INTEGER NOT NULL REFERENCES budget_line (id),
  category_id INTEGER NOT NULL REFERENCES category (id),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
  start_month TEXT NOT NULL CHECK (start_month GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  -- Empty while the version runs.
  end_month TEXT CHECK (
    end_month IS NULL OR (end_month GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND end_month >= start_month)
  ),
  -- Set when a later change replaced the version (R3, R4): it no longer counts.
  replaced_at TEXT,
  rhythm TEXT NOT NULL CHECK (rhythm IN ('every_n', 'months')),
  every_n INTEGER,
  anchor_month TEXT,
  -- Ticked months of the year, e.g. '1,2,3,4,5,6,9,10,11,12'.
  months TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (rhythm = 'every_n' AND typeof(every_n) = 'integer' AND every_n >= 1
      AND anchor_month IS NOT NULL AND anchor_month GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND months IS NULL)
    OR (rhythm = 'months' AND every_n IS NULL AND anchor_month IS NULL
      AND months IS NOT NULL AND months GLOB '[0-9]*' AND months NOT GLOB '*[^0-9,]*')
  )
);
CREATE INDEX budget_line_version_line ON budget_line_version (budget_line_id);

CREATE TABLE budget_override (
  id INTEGER PRIMARY KEY,
  budget_line_id INTEGER NOT NULL REFERENCES budget_line (id),
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  -- 0 cancels the line that month; the line still applies, at 0.
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents >= 0),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  -- Removing sets this date; the author of the removal is updated_by.
  removed_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- One override still in force per line and month.
CREATE UNIQUE INDEX budget_override_active ON budget_override (budget_line_id, month) WHERE removed_at IS NULL;

CREATE TABLE operation (
  id INTEGER PRIMARY KEY,
  op_date TEXT NOT NULL CHECK (op_date GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  value_date TEXT NOT NULL CHECK (value_date GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  -- Signed: + money in, - money out, as on the statement.
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer'),
  origin TEXT NOT NULL CHECK (origin IN ('import', 'manual')),
  -- Normalized first line of the bank label (R8), and the raw first line.
  bank_label TEXT CHECK (bank_label IS NULL OR length(bank_label) <= 500),
  bank_label_raw TEXT CHECK (bank_label_raw IS NULL OR length(bank_label_raw) <= 500),
  -- Rank among identical imported operations (spec 4.4).
  dup_rank INTEGER,
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 500),
  -- Only a deleted manual operation is archived.
  archived_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (origin = 'import' AND bank_label IS NOT NULL AND bank_label_raw IS NOT NULL
      AND typeof(dup_rank) = 'integer' AND dup_rank >= 1 AND archived_at IS NULL)
    OR (origin = 'manual' AND bank_label IS NULL AND bank_label_raw IS NULL AND dup_rank IS NULL
      AND op_date = value_date)
  )
);
-- The same imported operation can never be stored twice, even if two imports cross (spec 4.4).
CREATE UNIQUE INDEX operation_imported ON operation (op_date, value_date, amount_cents, bank_label, dup_rank)
  WHERE origin = 'import';
CREATE INDEX operation_value_date ON operation (value_date);

-- Its writes also raise the row_version of its operation (spec 4.3).
CREATE TABLE operation_part (
  id INTEGER PRIMARY KEY,
  operation_id INTEGER NOT NULL REFERENCES operation (id),
  -- Empty while the operation is to be categorized.
  category_id INTEGER REFERENCES category (id),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer'),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX operation_part_operation ON operation_part (operation_id);

-- A single row, entered at setup (spec 3.8); its date never changes.
CREATE TABLE opening_balance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  balance_date TEXT NOT NULL CHECK (balance_date GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer'),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Never modified, so no row_version; the gap is the one of that day, never recomputed.
CREATE TABLE balance_check (
  id INTEGER PRIMARY KEY,
  check_date TEXT NOT NULL CHECK (check_date GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  bank_balance_cents INTEGER NOT NULL CHECK (typeof(bank_balance_cents) = 'integer'),
  -- App balance minus bank balance.
  gap_cents INTEGER NOT NULL CHECK (typeof(gap_cents) = 'integer'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Technical, a single row. schema_version follows the number of the last migration.
CREATE TABLE meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  last_export_at TEXT,
  restore_in_progress INTEGER NOT NULL DEFAULT 0 CHECK (restore_in_progress IN (0, 1))
);
INSERT INTO meta (id, schema_version) VALUES (1, 1);

-- Technical, always empty. A write batch adds one "guard" per condition it depends on:
--   INSERT INTO write_guard (failed) SELECT 1 WHERE NOT (<condition>)
-- When the condition is false, the insert breaks the constraint and D1 cancels the whole
-- batch (spec 4.3: conditions are checked in the write itself).
CREATE TABLE write_guard (
  failed INTEGER NOT NULL,
  CONSTRAINT guard CHECK (failed = 0)
);
