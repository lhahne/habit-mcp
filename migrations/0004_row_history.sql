CREATE TABLE habits_history (
  history_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id     INTEGER NOT NULL,
  name         TEXT    NOT NULL,
  description  TEXT,
  start_date   TEXT    NOT NULL,
  end_date     TEXT,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  archived_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  operation    TEXT    NOT NULL CHECK (operation IN ('UPDATE','DELETE'))
);

CREATE INDEX idx_habits_history_habit_id ON habits_history(habit_id);

CREATE TABLE days_history (
  history_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT    NOT NULL,
  comment      TEXT    NOT NULL,
  weight       REAL,
  exercise     TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  archived_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  operation    TEXT    NOT NULL CHECK (operation IN ('UPDATE','DELETE'))
);

CREATE INDEX idx_days_history_date ON days_history(date);

CREATE TABLE check_ins_history (
  history_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id     INTEGER NOT NULL,
  date         TEXT    NOT NULL,
  done         INTEGER NOT NULL,
  note         TEXT,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  archived_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  operation    TEXT    NOT NULL CHECK (operation IN ('UPDATE','DELETE'))
);

CREATE INDEX idx_check_ins_history_habit_date ON check_ins_history(habit_id, date);

CREATE TRIGGER habits_history_on_update
AFTER UPDATE ON habits
FOR EACH ROW
BEGIN
  INSERT INTO habits_history
    (habit_id, name, description, start_date, end_date, created_at, updated_at, operation)
  VALUES
    (OLD.id, OLD.name, OLD.description, OLD.start_date, OLD.end_date, OLD.created_at, OLD.updated_at, 'UPDATE');
END;

CREATE TRIGGER habits_history_on_delete
AFTER DELETE ON habits
FOR EACH ROW
BEGIN
  INSERT INTO habits_history
    (habit_id, name, description, start_date, end_date, created_at, updated_at, operation)
  VALUES
    (OLD.id, OLD.name, OLD.description, OLD.start_date, OLD.end_date, OLD.created_at, OLD.updated_at, 'DELETE');
END;

CREATE TRIGGER days_history_on_update
AFTER UPDATE ON days
FOR EACH ROW
BEGIN
  INSERT INTO days_history
    (date, comment, weight, exercise, created_at, updated_at, operation)
  VALUES
    (OLD.date, OLD.comment, OLD.weight, OLD.exercise, OLD.created_at, OLD.updated_at, 'UPDATE');
END;

CREATE TRIGGER days_history_on_delete
AFTER DELETE ON days
FOR EACH ROW
BEGIN
  INSERT INTO days_history
    (date, comment, weight, exercise, created_at, updated_at, operation)
  VALUES
    (OLD.date, OLD.comment, OLD.weight, OLD.exercise, OLD.created_at, OLD.updated_at, 'DELETE');
END;

CREATE TRIGGER check_ins_history_on_update
AFTER UPDATE ON check_ins
FOR EACH ROW
BEGIN
  INSERT INTO check_ins_history
    (habit_id, date, done, note, created_at, updated_at, operation)
  VALUES
    (OLD.habit_id, OLD.date, OLD.done, OLD.note, OLD.created_at, OLD.updated_at, 'UPDATE');
END;

CREATE TRIGGER check_ins_history_on_delete
AFTER DELETE ON check_ins
FOR EACH ROW
BEGIN
  INSERT INTO check_ins_history
    (habit_id, date, done, note, created_at, updated_at, operation)
  VALUES
    (OLD.habit_id, OLD.date, OLD.done, OLD.note, OLD.created_at, OLD.updated_at, 'DELETE');
END;
