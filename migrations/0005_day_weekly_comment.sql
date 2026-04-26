ALTER TABLE days ADD COLUMN weekly_comment TEXT NOT NULL DEFAULT '';
ALTER TABLE days_history ADD COLUMN weekly_comment TEXT NOT NULL DEFAULT '';

DROP TRIGGER days_history_on_update;
DROP TRIGGER days_history_on_delete;

CREATE TRIGGER days_history_on_update
AFTER UPDATE ON days
FOR EACH ROW
BEGIN
  INSERT INTO days_history
    (date, comment, weight, exercise, weekly_comment, created_at, updated_at, operation)
  VALUES
    (OLD.date, OLD.comment, OLD.weight, OLD.exercise, OLD.weekly_comment, OLD.created_at, OLD.updated_at, 'UPDATE');
END;

CREATE TRIGGER days_history_on_delete
AFTER DELETE ON days
FOR EACH ROW
BEGIN
  INSERT INTO days_history
    (date, comment, weight, exercise, weekly_comment, created_at, updated_at, operation)
  VALUES
    (OLD.date, OLD.comment, OLD.weight, OLD.exercise, OLD.weekly_comment, OLD.created_at, OLD.updated_at, 'DELETE');
END;
