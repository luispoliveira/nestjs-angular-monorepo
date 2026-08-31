-- CreateTable
CREATE TABLE "rls_note" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "rls_note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rls_note_organization_id_idx" ON "rls_note"("organization_id");

-- Row-level security -----------------------------------------------------
-- ENABLE alone is not enough: the table owner still bypasses the policy.
-- FORCE makes the policy apply to the owner too. Superusers and roles with
-- BYPASSRLS ignore both, which is why the application must never connect as
-- one. See packages/database/scripts/rls-poc-setup.mjs.
ALTER TABLE "rls_note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rls_note" FORCE ROW LEVEL SECURITY;

-- current_setting(..., true) returns NULL when the variable is unset, so a
-- connection with no tenant context matches no rows and can write none.
-- Fail closed, not open.
CREATE POLICY "rls_note_tenant_isolation" ON "rls_note"
    USING ("organization_id" = current_setting('app.current_tenant_id', true))
    WITH CHECK ("organization_id" = current_setting('app.current_tenant_id', true));
