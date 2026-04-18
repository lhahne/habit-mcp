CREATE TABLE habits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  description  TEXT,
  start_date   TEXT    NOT NULL,
  end_date     TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE days (
  date         TEXT    PRIMARY KEY,
  comment      TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE check_ins (
  habit_id     INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,
  done         INTEGER NOT NULL DEFAULT 1,
  note         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (habit_id, date)
);

CREATE INDEX idx_check_ins_date ON check_ins(date);
CREATE INDEX idx_habits_dates  ON habits(start_date, end_date);
