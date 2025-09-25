-- Enforce unique unit code to prevent duplication.
-- Safe guard: if duplicates exist, skip adding the constraint and emit a NOTICE.
DO $
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT code
    FROM units
    WHERE code IS NOT NULL
    GROUP BY code
    HAVING COUNT(*) > 1
  ) AS d;

  IF dup_count = 0 THEN
    -- Add unique constraint; if it already exists, ignore
    BEGIN
      ALTER TABLE IF EXISTS units
        ADD CONSTRAINT units_code_unique UNIQUE (code);
    EXCEPTION WHEN duplicate_object THEN
      -- Constraint already exists
      NULL;
    END;
  ELSE
    RAISE NOTICE 'Skipping units_code_unique constraint: found % duplicate code(s). Clean duplicates and re-run migration.', dup_count;
  END IF;
END;
$ LANGUAGE plpgsql;