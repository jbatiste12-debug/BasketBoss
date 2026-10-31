-- BasketBoss self-service account deletion, 2026-10-31.
-- Apply in the production Supabase SQL editor as the database owner AFTER the
-- household and receipt-inventory migrations. Applying this file deletes no
-- accounts or saved plans. Only the server-only RPC performs a deletion.
-- The authenticated Cloudflare deletion workflow must first confirm the user's
-- identity and cancel/reconcile Paddle billing. No browser may execute this RPC.
BEGIN;

DO $$
BEGIN
 IF to_regclass('public.bb_households') IS NULL OR
    to_regclass('public.bb_household_invites') IS NULL OR
    to_regclass('public.bb_household_entries') IS NULL OR
    to_regclass('public.bb_receipt_inventory_scopes') IS NULL OR
    to_regclass('public.bb_receipt_inventory_receipts') IS NULL OR
    to_regclass('public.bb_receipt_inventory_requests') IS NULL OR
    to_regclass('public.bb_receipt_inventory_legacy_claims') IS NULL
 THEN RAISE EXCEPTION 'Apply BasketBoss household and receipt-inventory migrations before account deletion'; END IF;
 -- The legacy optional cloud-backup table predates the checked-in migrations.
 -- A real FK prevents a still-valid old JWT from restoring its deleted user's
 -- cloud plan. NOT VALID avoids changing pre-existing orphan data at install;
 -- PostgreSQL still enforces all subsequent inserts/updates and parent deletes.
 IF to_regclass('public.basketboss_data') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM pg_constraint c
   WHERE c.conrelid=to_regclass('public.basketboss_data') AND c.contype='f'
    AND c.confrelid='auth.users'::regclass AND c.confdeltype='c'
    AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid=to_regclass('public.basketboss_data') AND attname='user_id')]::smallint[]
    AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid='auth.users'::regclass AND attname='id')]::smallint[]
 ) THEN
  ALTER TABLE public.basketboss_data ADD CONSTRAINT bb_account_data_user_cascade
   FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.bb_account_deletion_ready()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cloud_exists boolean:=to_regclass('public.basketboss_data') IS NOT NULL; cloud_safe boolean;
 auth_safe boolean; auth_table text; auth_relation regclass;
BEGIN
 cloud_safe:=NOT cloud_exists OR EXISTS (
  SELECT 1 FROM pg_constraint c
   WHERE c.conrelid=to_regclass('public.basketboss_data') AND c.contype='f'
    AND c.confrelid='auth.users'::regclass AND c.confdeltype='c'
    AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid=to_regclass('public.basketboss_data') AND attname='user_id')]::smallint[]
    AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid='auth.users'::regclass AND attname='id')]::smallint[]
 );
 -- Supabase-managed auth tables may give a migration owner SELECT without
 -- DELETE. Check the definer's privileges before the server cancels billing.
 auth_safe:=has_table_privilege(current_user,'auth.users','SELECT') AND
  has_table_privilege(current_user,'auth.users','UPDATE') AND
  has_table_privilege(current_user,'auth.users','DELETE') AND
  EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls));
 FOREACH auth_table IN ARRAY ARRAY['auth.refresh_tokens','auth.flow_state'] LOOP
  auth_relation:=to_regclass(auth_table);
  IF auth_relation IS NOT NULL THEN
   auth_safe:=auth_safe AND has_table_privilege(current_user,auth_relation,'SELECT') AND
    has_table_privilege(current_user,auth_relation,'DELETE');
  END IF;
 END LOOP;
 RETURN jsonb_build_object('version',1,'ready',cloud_safe AND auth_safe AND
  to_regclass('public.bb_households') IS NOT NULL AND
  to_regclass('public.bb_household_invites') IS NOT NULL AND
  to_regclass('public.bb_household_entries') IS NOT NULL AND
  to_regclass('public.bb_receipt_inventory_scopes') IS NOT NULL AND
  to_regclass('public.bb_receipt_inventory_receipts') IS NOT NULL AND
  to_regclass('public.bb_receipt_inventory_requests') IS NOT NULL AND
  to_regclass('public.bb_receipt_inventory_legacy_claims') IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.bb_account_deletion_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_account_deletion_ready() TO service_role;

CREATE OR REPLACE FUNCTION public.bb_account_delete_data(p_user uuid,p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE verified_email text; locked_email text; h record;
BEGIN
 IF p_user IS NULL OR p_email IS NULL OR length(btrim(p_email)) NOT BETWEEN 3 AND 254
 THEN RAISE EXCEPTION 'account_delete_invalid_identity' USING ERRCODE='22023'; END IF;
 IF NOT (public.bb_account_deletion_ready()->>'ready')::boolean
 THEN RAISE EXCEPTION 'account_delete_migration_not_ready'; END IF;
 -- Serialize retries without storing email or account-deletion history here.
 PERFORM pg_advisory_xact_lock(hashtextextended('bb-account-delete:'||p_user::text,0));
 SELECT lower(u.email) INTO verified_email FROM auth.users u WHERE u.id=p_user;
 IF FOUND AND (verified_email IS NULL OR verified_email<>lower(btrim(p_email)))
 THEN RAISE EXCEPTION 'account_delete_identity_mismatch' USING ERRCODE='42501'; END IF;
 -- If auth was already removed, clean only UUID references. In particular, a
 -- retry must not unlink a newly-created different account with the same email.

 -- Same lock order as shared receipt mutations: household row, then scope.
 -- Lock BEFORE taking an exclusive auth.users lock: an in-flight receipt may
 -- hold household/scope locks and need a user FK KEY SHARE lock to finish.
 FOR h IN SELECT id FROM public.bb_households
   WHERE owner_user_id=p_user OR partner_user_id=p_user OR
    (verified_email IS NOT NULL AND lower(partner_email)=verified_email) OR
    id IN (SELECT household_id FROM public.bb_household_invites
      WHERE accepted_by=p_user OR (verified_email IS NOT NULL AND lower(partner_email)=verified_email))
   ORDER BY id FOR UPDATE
 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('bb-receipt:household:'||h.id::text,0));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('bb-receipt:user:'||p_user::text,0));

 -- Lock the actual identity after in-flight scoped writes have drained. FK
 -- checks serialize any concurrent new household/cloud/scope writes with the
 -- final auth deletion; those records either cascade or fail their FK check.
 SELECT lower(email) INTO locked_email FROM auth.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN verified_email:=NULL;
 ELSIF locked_email IS DISTINCT FROM verified_email THEN
  RAISE EXCEPTION 'account_delete_identity_changed' USING ERRCODE='42501';
 END IF;
 DELETE FROM public.bb_household_invites
  WHERE accepted_by=p_user OR
   (verified_email IS NOT NULL AND lower(partner_email)=verified_email) OR
   household_id IN (SELECT id FROM public.bb_households
    WHERE owner_user_id=p_user OR partner_user_id=p_user OR
     (verified_email IS NOT NULL AND lower(partner_email)=verified_email));
 UPDATE public.bb_households SET partner_user_id=NULL,partner_email=NULL,
  invite_status='none',updated_at=now()
  WHERE owner_user_id<>p_user AND
   (partner_user_id=p_user OR (verified_email IS NOT NULL AND lower(partner_email)=verified_email));
 -- Personal receipt children cascade; shared records stay with their owner.
 DELETE FROM public.bb_receipt_inventory_scopes WHERE scope_kind='user' AND user_id=p_user;
 DELETE FROM public.bb_households WHERE owner_user_id=p_user;
 UPDATE public.bb_household_entries SET updated_by=NULL WHERE updated_by=p_user;
 UPDATE public.bb_receipt_inventory_receipts SET created_by=NULL WHERE created_by=p_user;
 IF to_regclass('public.basketboss_data') IS NOT NULL THEN
  EXECUTE 'DELETE FROM public.basketboss_data WHERE user_id=$1' USING p_user;
 END IF;
 -- Upstream Supabase Auth retains legacy refresh tokens with user_id varchar
 -- and nullable session_id. Only session-linked tokens are covered by the
 -- auth.users -> sessions -> refresh_tokens cascade. Remove both generations.
 -- Sources: supabase/auth migrations/00_init_auth_schema.up.sql and
 -- migrations/20220811173540_add_sessions_table.up.sql.
 IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
  EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id=$1' USING p_user::text;
 END IF;
 -- PKCE/OAuth flow state has UUID user_id but no user FK, and can contain
 -- provider credentials. Remove only flows tied to this UUID, including a
 -- linking target where that newer optional column exists. Audit/security logs
 -- have independent retention and are deliberately not changed here.
 -- Sources: supabase/auth migrations/20230322519590_add_flow_state_table.up.sql
 -- and migrations/20260115000000_add_flow_state_oauth_context.up.sql.
 IF to_regclass('auth.flow_state') IS NOT NULL THEN
  EXECUTE 'DELETE FROM auth.flow_state WHERE user_id=$1' USING p_user;
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('auth.flow_state')
    AND attname='linking_target_id' AND NOT attisdropped) THEN
   EXECUTE 'DELETE FROM auth.flow_state WHERE linking_target_id=$1' USING p_user;
  END IF;
 END IF;
 -- Hard delete identity and its auth sessions LAST, in this same transaction.
 -- Any unexpected FK/storage restriction rolls back the entire operation.
 DELETE FROM auth.users WHERE id=p_user;
 RETURN jsonb_build_object('deleted',true,'version',1);
END $$;
REVOKE ALL ON FUNCTION public.bb_account_delete_data(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_account_delete_data(uuid,text) TO service_role;

-- Preserve existing patch validation/CAS semantics while locking membership
-- against account deletion/unlink. No direct client grants are introduced.
CREATE OR REPLACE FUNCTION public.bb_hh_service_patch(
 p_actor uuid,p_household uuid,p_section text,p_key text,
 p_value jsonb,p_expected bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_row public.bb_household_entries%ROWTYPE; n bigint;
BEGIN
 IF p_actor IS NULL OR p_household IS NULL OR p_expected IS NULL OR p_expected<0 OR
    p_section NOT IN ('planned_day','servings','pantry_item','kitchen_item','shopping_checked','budget_target','household_servings') OR
    p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 180 OR p_value IS NULL OR
    octet_length(p_value::text)>8192
 THEN RAISE EXCEPTION 'invalid_patch' USING ERRCODE='22023'; END IF;
 IF p_section IN ('planned_day','servings') AND p_key NOT IN
   ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')
 THEN RAISE EXCEPTION 'invalid_day' USING ERRCODE='22023'; END IF;
 IF p_section='household_servings' AND p_key<>'default'
 THEN RAISE EXCEPTION 'invalid_household_servings_key' USING ERRCODE='22023'; END IF;
 IF p_section='budget_target' AND p_key<>'weekly'
 THEN RAISE EXCEPTION 'invalid_budget_key' USING ERRCODE='22023'; END IF;
 IF p_value <> '{"deleted":true}'::jsonb THEN
  IF (p_section='planned_day' AND
      (jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR jsonb_typeof(p_value->'recipeId') IS DISTINCT FROM 'string' OR
       length(p_value->>'recipeId') NOT BETWEEN 1 AND 256)) OR
     (p_section IN ('servings','household_servings') AND
      (jsonb_typeof(p_value->'count') IS DISTINCT FROM 'number' OR
       (p_value->>'count') !~ '^[0-9]{1,2}$' OR
       (p_value->>'count')::integer NOT BETWEEN 1 AND 12)) OR
     (p_section='budget_target' AND
      (jsonb_typeof(p_value->'amount') IS DISTINCT FROM 'number' OR
       (p_value->>'amount') !~ '^[0-9]+(\.[0-9]+)?$' OR
       (p_value->>'amount')::numeric NOT BETWEEN 1 AND 10000)) OR
     (p_section='shopping_checked' AND jsonb_typeof(p_value) IS DISTINCT FROM 'boolean') OR
     (p_section='pantry_item' AND
      ((p_key LIKE 'simple:%' AND jsonb_typeof(p_value) IS DISTINCT FROM 'boolean') OR
       (p_key LIKE 'measured:%' AND (jsonb_typeof(p_value) IS DISTINCT FROM 'number' OR
         (p_value::text)::numeric<0)) OR
       (p_key NOT LIKE 'simple:%' AND p_key NOT LIKE 'measured:%'))) OR
     (p_section='kitchen_item' AND jsonb_typeof(p_value) IS DISTINCT FROM 'object')
  THEN RAISE EXCEPTION 'invalid_shared_value' USING ERRCODE='22023'; END IF;
 END IF;
 PERFORM h.id FROM public.bb_households h
  WHERE h.id=p_household AND
   EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor AND u.email_confirmed_at IS NOT NULL) AND
   (h.owner_user_id=p_actor OR (h.partner_user_id=p_actor AND h.invite_status='accepted'))
  FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'membership_required' USING ERRCODE='42501'; END IF;
 IF p_expected=0 THEN
  INSERT INTO public.bb_household_entries(household_id,section,entry_key,value,updated_by)
   VALUES(p_household,p_section,p_key,p_value,p_actor)
   ON CONFLICT DO NOTHING RETURNING revision INTO n;
 ELSE
  UPDATE public.bb_household_entries SET value=p_value,
   revision=revision+1,updated_at=now(),updated_by=p_actor
   WHERE household_id=p_household AND section=p_section AND entry_key=p_key
    AND revision=p_expected RETURNING revision INTO n;
 END IF;
 IF n IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'revision',n); END IF;
 SELECT * INTO current_row FROM public.bb_household_entries
  WHERE household_id=p_household AND section=p_section AND entry_key=p_key;
 RETURN jsonb_build_object('ok',false,'conflict',true,'revision',coalesce(current_row.revision,0),
  'value',current_row.value,'updated_at',current_row.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.bb_hh_service_patch(uuid,uuid,text,text,jsonb,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_hh_service_patch(uuid,uuid,text,text,jsonb,bigint) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
