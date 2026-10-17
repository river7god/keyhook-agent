-- Row-level security (decisions.md: "RLS for request-scoped access").
-- Request handlers run inside withOrg(): SET LOCAL ROLE keyhook_app + app.organization_id.
-- keyhook_app is NOLOGIN, non-superuser, no BYPASSRLS, so every query it runs is filtered to one
-- organization; a missing setting raises an error (fail closed). Background workers keep the
-- owner role and pass organizationId explicitly (plus composite FKs). sessions is auth
-- infrastructure, read before the organization is known, and is not granted to keyhook_app.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'keyhook_app') THEN
    CREATE ROLE keyhook_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
GRANT keyhook_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO keyhook_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO keyhook_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO keyhook_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO keyhook_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO keyhook_app;
--> statement-breakpoint
REVOKE ALL ON TABLE sessions FROM keyhook_app;
--> statement-breakpoint
-- Fails closed: no (or empty) organization context is an error, never "all rows".
CREATE FUNCTION app_current_organization_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v text := current_setting('app.organization_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'app.organization_id is not set' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v::uuid;
END
$$;
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON organizations
  USING (id = app_current_organization_id())
  WITH CHECK (id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE property_managers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON property_managers
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE owners ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON owners
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON properties
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON tenants
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE tenancies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON tenancies
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE tenancy_tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON tenancy_tenants
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE tradies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON tradies
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE tradie_availability ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON tradie_availability
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON jobs
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON messages
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON approvals
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON audit_log
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON follow_ups
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON idempotency_keys
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_isolation ON llm_calls
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
