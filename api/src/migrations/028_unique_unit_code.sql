-- Enforce unique unit code to prevent duplication.
-- Safe guard: if duplicates exist, skip adding the constraint and emit a NOTICE
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
    ALTER TABLE IF EXISTS units
      ADD CONSTRAINT IF NOT EXISTS units_code_unique UNIQUE (code);
  ELSE
    RAISE NOTICE 'Skipping units_code_unique constraint: found % duplicate code(s). Clean duplicates and re-run migration.', dup_count;
  END IF;
END;
$ LANGUAGE plpgsql;
-- Safe guard: if duplicates exist, skip adding the constraint and emit a NOTICE
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
    ALTER TABLE IF EXISTS units
      ADD CONSTRAINT IF NOT EXISTS units_code_unique UNIQUE (code);
  ELSE
    RAISE NOTICE 'Skipping units_code_unique constraint: found % duplicate code(s). Clean duplicates and re-run migration.', dup_count;
  END IF;
END;
$;