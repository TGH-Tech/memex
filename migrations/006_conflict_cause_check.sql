-- 006_conflict_cause_check.sql
-- Defensive CHECK constraint on pages_conflicts.cause. Application code only
-- writes 'concurrent_edit' or 'cache_loss_fallback'; PRD §6.1 also lists
-- 'unknown' as a valid value. Anything else is a typo or future bug we want
-- the DB to catch at write time, not at audit time.

ALTER TABLE pages_conflicts
  ADD CONSTRAINT pages_conflicts_cause_check
  CHECK (cause IN ('concurrent_edit', 'cache_loss_fallback', 'unknown'));
