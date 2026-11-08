-- Optional meal backup, isolated from legacy whole-plan uploads.
-- Review and apply in basketboss-auth; this install script is not activation.
BEGIN;

DO $preflight$
DECLARE relation oid:=to_regclass('public.basketboss_planner_extras_v1'); owner_column smallint; generation_column smallint;
BEGIN
 IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
  RAISE EXCEPTION 'planner_extras_preflight_auth';
 END IF;
 IF relation IS NULL THEN RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=relation AND relkind='r' AND relpersistence='p' AND NOT relispartition) OR
    (SELECT count(*) FROM pg_attribute WHERE attrelid=relation AND attnum>0 AND NOT attisdropped)<>5 OR
    (SELECT count(*) FROM pg_attribute WHERE attrelid=relation AND attnum>0 AND NOT attisdropped AND attnotnull AND attidentity='' AND attgenerated='' AND
     ((attname='user_id' AND atttypid='uuid'::regtype) OR (attname='plan_generation' AND atttypid='text'::regtype) OR
      (attname='payload' AND atttypid='jsonb'::regtype) OR (attname='revision' AND atttypid='bigint'::regtype) OR
      (attname='updated_at' AND atttypid='timestamptz'::regtype)))<>5
 THEN RAISE EXCEPTION 'planner_extras_preflight_shape'; END IF;
 SELECT attnum INTO owner_column FROM pg_attribute WHERE attrelid=relation AND attname='user_id' AND NOT attisdropped;
 SELECT attnum INTO generation_column FROM pg_attribute WHERE attrelid=relation AND attname='plan_generation' AND NOT attisdropped;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid=relation AND contype<>'n')<>5 OR
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=relation AND contype='p' AND convalidated AND conkey=ARRAY[owner_column,generation_column]::smallint[]) OR
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=relation AND contype='f' AND convalidated AND conkey=ARRAY[owner_column]::smallint[] AND confrelid='auth.users'::regclass AND confdeltype='c') OR
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=relation AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'planner_extras_preflight_shape'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=relation AND polname NOT IN ('bb_planner_extras_select_own','bb_planner_extras_insert_own','bb_planner_extras_update_own'))
 THEN RAISE EXCEPTION 'planner_extras_preflight_policy'; END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.bb_planner_extras_payload_valid_v1(p_payload jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE item jsonb; seen_days text[]:='{}'; seen_portions jsonb:='[]'::jsonb; identity jsonb;
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR
    p_payload->'version' IS DISTINCT FROM '1'::jsonb OR
    (SELECT count(*) FROM jsonb_object_keys(p_payload))<>3 OR
    NOT (p_payload ?& ARRAY['version','plannedBreakfasts','portionOverrides']) OR
    jsonb_typeof(p_payload->'plannedBreakfasts') IS DISTINCT FROM 'array' OR
    jsonb_typeof(p_payload->'portionOverrides') IS DISTINCT FROM 'array'
 THEN RETURN false; END IF;
 IF jsonb_array_length(p_payload->'plannedBreakfasts')>7 OR jsonb_array_length(p_payload->'portionOverrides')>21 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'plannedBreakfasts') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR NOT (item ?& ARRAY['day','recipeId']) OR
     jsonb_typeof(item->'day') IS DISTINCT FROM 'string' OR
     NOT (item->>'day'=ANY(ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])) OR
     (item->>'day')=ANY(seen_days) OR jsonb_typeof(item->'recipeId') IS DISTINCT FROM 'string' OR
     length(item->>'recipeId') NOT BETWEEN 1 AND 256 OR btrim(item->>'recipeId')<>item->>'recipeId' OR
     item->>'recipeId' IN ('__proto__','constructor','prototype') OR item->>'recipeId' ~ '[[:cntrl:]]'
  THEN RETURN false; END IF;
  seen_days:=array_append(seen_days,item->>'day');
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'portionOverrides') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(item))<>4 OR NOT (item ?& ARRAY['kind','day','recipeId','servings']) OR
     jsonb_typeof(item->'kind') IS DISTINCT FROM 'string' OR item->>'kind' NOT IN ('dinner','breakfast','dessert') OR
     jsonb_typeof(item->'day') IS DISTINCT FROM 'string' OR
     NOT (item->>'day'=ANY(ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])) OR
     jsonb_typeof(item->'recipeId') IS DISTINCT FROM 'string' OR length(item->>'recipeId') NOT BETWEEN 1 AND 256 OR
     btrim(item->>'recipeId')<>item->>'recipeId' OR item->>'recipeId' IN ('__proto__','constructor','prototype') OR item->>'recipeId' ~ '[[:cntrl:]]' OR
     jsonb_typeof(item->'servings') IS DISTINCT FROM 'number' OR item->>'servings' !~ '^([1-9]|1[0-2])$'
  THEN RETURN false; END IF;
  identity:=jsonb_build_object('kind',item->>'kind','day',item->>'day','recipeId',item->>'recipeId');
  IF seen_portions @> jsonb_build_array(identity) THEN RETURN false; END IF;
  seen_portions:=seen_portions||jsonb_build_array(identity);
  IF item->>'kind'='breakfast' AND NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements(p_payload->'plannedBreakfasts') row
   WHERE row->>'day'=item->>'day' AND row->>'recipeId'=item->>'recipeId'
  ) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.bb_planner_extras_payload_valid_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bb_planner_extras_payload_valid_v1(jsonb) TO authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.basketboss_planner_extras_v1 (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 plan_generation text NOT NULL CHECK (plan_generation ~ '^[A-Za-z0-9_-]{1,80}$'),
 payload jsonb NOT NULL CHECK (public.bb_planner_extras_payload_valid_v1(payload)),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,plan_generation)
);
ALTER TABLE public.basketboss_planner_extras_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.basketboss_planner_extras_v1 FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA public TO authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.basketboss_planner_extras_v1 TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.basketboss_planner_extras_v1 TO service_role;
DROP POLICY IF EXISTS bb_planner_extras_select_own ON public.basketboss_planner_extras_v1;
CREATE POLICY bb_planner_extras_select_own ON public.basketboss_planner_extras_v1 FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
DROP POLICY IF EXISTS bb_planner_extras_insert_own ON public.basketboss_planner_extras_v1;
CREATE POLICY bb_planner_extras_insert_own ON public.basketboss_planner_extras_v1 FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid())=user_id);
DROP POLICY IF EXISTS bb_planner_extras_update_own ON public.basketboss_planner_extras_v1;
CREATE POLICY bb_planner_extras_update_own ON public.basketboss_planner_extras_v1 FOR UPDATE TO authenticated USING ((SELECT auth.uid())=user_id) WITH CHECK ((SELECT auth.uid())=user_id);

CREATE OR REPLACE FUNCTION public.bb_save_planner_extras_v1(p_generation text,p_payload jsonb,p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); saved public.basketboss_planner_extras_v1%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='planner_extras_sign_in_required'; END IF;
 IF p_generation IS NULL OR p_generation !~ '^[A-Za-z0-9_-]{1,80}$' OR
    NOT public.bb_planner_extras_payload_valid_v1(p_payload) OR
    p_expected_revision IS NULL OR p_expected_revision<0 OR p_expected_revision>=9007199254740991
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='planner_extras_invalid'; END IF;
 IF p_expected_revision=0 THEN
  INSERT INTO public.basketboss_planner_extras_v1(user_id,plan_generation,payload)
   VALUES(actor,p_generation,p_payload) ON CONFLICT(user_id,plan_generation) DO NOTHING RETURNING * INTO saved;
 ELSE
  UPDATE public.basketboss_planner_extras_v1 SET payload=p_payload,revision=revision+1,updated_at=now()
   WHERE user_id=actor AND plan_generation=p_generation AND revision=p_expected_revision RETURNING * INTO saved;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='planner_extras_conflict'; END IF;
 RETURN jsonb_build_object('ok',true,'payload',saved.payload,'revision',saved.revision);
END $$;
REVOKE ALL ON FUNCTION public.bb_save_planner_extras_v1(text,jsonb,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bb_save_planner_extras_v1(text,jsonb,bigint) TO authenticated;
COMMENT ON TABLE public.basketboss_planner_extras_v1 IS 'Owner-only optional meals and per-slot servings; separate from legacy backup and never an entitlement source.';
NOTIFY pgrst,'reload schema';
COMMIT;
