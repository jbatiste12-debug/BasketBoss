-- BasketBoss personal cloud backups. Apply only in basketboss-auth
-- (kbhyosxuvlcazyzzinqv) after reviewing docs/CLOUD_BACKUP_SETUP.md.
-- This creates no users, purchases, memberships, or household records.
BEGIN;

DO $preflight$
DECLARE
  relation oid := to_regclass('public.basketboss_data');
  user_column smallint;
BEGIN
  IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')
  THEN RAISE EXCEPTION 'basketboss_data_preflight: expected Supabase Auth schema and roles'; END IF;

  IF relation IS NOT NULL THEN
    -- Never reinterpret a differently shaped legacy table, view, or partition.
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation AND relkind='r'
                   AND relpersistence='p' AND NOT relispartition) OR
       (SELECT count(*) FROM pg_attribute WHERE attrelid=relation
         AND attnum>0 AND NOT attisdropped)<>3 OR
       (SELECT count(*) FROM pg_attribute WHERE attrelid=relation AND attnum>0
         AND NOT attisdropped AND attnotnull AND attidentity='' AND attgenerated=''
         AND ((attname='user_id' AND atttypid='uuid'::regtype) OR
              (attname='data' AND atttypid='jsonb'::regtype) OR
              (attname='updated_at' AND atttypid='timestamptz'::regtype)))<>3
    THEN RAISE EXCEPTION 'basketboss_data_preflight_shape: inspect the existing table before continuing'; END IF;

    SELECT attnum INTO user_column FROM pg_attribute
      WHERE attrelid=relation AND attname='user_id' AND NOT attisdropped;
    IF (SELECT count(*) FROM pg_constraint WHERE conrelid=relation AND contype<>'n')<>3 OR
       NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=relation
         AND conname='basketboss_data_pkey' AND contype='p' AND convalidated
         AND conkey=ARRAY[user_column]::smallint[]) OR
       NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=relation
         AND conname='basketboss_data_user_id_fkey' AND contype='f' AND convalidated
         AND conkey=ARRAY[user_column]::smallint[] AND confrelid='auth.users'::regclass
         AND confkey=ARRAY[(SELECT attnum FROM pg_attribute
           WHERE attrelid='auth.users'::regclass AND attname='id')]::smallint[]
         AND confdeltype='c' AND NOT condeferrable) OR
       NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=relation
         AND conname='basketboss_data_data_is_object' AND contype='c' AND convalidated
         AND regexp_replace(pg_get_expr(conbin,conrelid),'[[:space:]()]','','g')=
             'jsonb_typeofdata=''object''::text')
    THEN RAISE EXCEPTION 'basketboss_data_preflight_shape: inspect existing constraints before continuing'; END IF;

    IF EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a
       ON a.attrelid=d.adrelid AND a.attnum=d.adnum
       WHERE d.adrelid=relation AND a.attname='user_id') OR
       NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a
         ON a.attrelid=d.adrelid AND a.attnum=d.adnum
         WHERE d.adrelid=relation AND a.attname='data'
           AND pg_get_expr(d.adbin,d.adrelid)='''{}''::jsonb') OR
       NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a
         ON a.attrelid=d.adrelid AND a.attnum=d.adnum
         WHERE d.adrelid=relation AND a.attname='updated_at'
           AND pg_get_expr(d.adbin,d.adrelid)='now()') OR
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=relation AND NOT tgisinternal)
    THEN RAISE EXCEPTION 'basketboss_data_preflight_shape: inspect existing defaults or triggers before continuing'; END IF;

    -- A permissive policy is OR-ed with the owner rules. Unknown policies need
    -- explicit review instead of silently retaining broader access.
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=relation AND polname NOT IN
       ('basketboss_data_select_own','basketboss_data_insert_own','basketboss_data_update_own'))
    THEN RAISE EXCEPTION 'basketboss_data_preflight_policy: inspect unexpected policies before continuing'; END IF;
  END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS public.basketboss_data (
  user_id uuid NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT basketboss_data_pkey PRIMARY KEY (user_id),
  CONSTRAINT basketboss_data_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT basketboss_data_data_is_object CHECK (jsonb_typeof(data)='object')
);

ALTER TABLE public.basketboss_data ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.basketboss_data FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA public TO authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.basketboss_data TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.basketboss_data TO service_role;

DROP POLICY IF EXISTS basketboss_data_select_own ON public.basketboss_data;
CREATE POLICY basketboss_data_select_own ON public.basketboss_data
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
DROP POLICY IF EXISTS basketboss_data_insert_own ON public.basketboss_data;
CREATE POLICY basketboss_data_insert_own ON public.basketboss_data
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid())=user_id);
DROP POLICY IF EXISTS basketboss_data_update_own ON public.basketboss_data;
CREATE POLICY basketboss_data_update_own ON public.basketboss_data
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid())=user_id)
  WITH CHECK ((SELECT auth.uid())=user_id);

COMMENT ON TABLE public.basketboss_data IS
  'BasketBoss owner-only personal plan and Kitchen backup; never an entitlement source.';
NOTIFY pgrst, 'reload schema';
COMMIT;
