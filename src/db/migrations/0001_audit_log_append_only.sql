-- audit_log is append-only (CLAUDE.md rule 4). Row-level UPDATE/DELETE are rejected for every
-- role, including the app's. TRUNCATE is intentionally still allowed so dev seed/reset and the
-- test harness can wipe the table; production roles should not be granted TRUNCATE.
CREATE FUNCTION audit_log_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();
