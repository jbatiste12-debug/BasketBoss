-- Household deliberate-edit synchronization v2. Review/apply separately as DB owner.
-- This file creates functions only: existing tables, columns, constraints, receipt
-- history, accounting, pricing and authorization policy remain authoritative.
-- All RPCs are server-only, behind the existing session/Premium household API.
BEGIN;

-- Reserve the metadata namespace at the older write boundary as well as the API.
DO $namespace$
DECLARE definition text;
 needle text := 'p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 180 OR p_value IS NULL OR';
 replacement text := 'p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 180 OR starts_with(p_key,''__bb_sync_v2:'') OR p_value IS NULL OR';
 lock_needle text := 'IF p_expected=0 THEN';
 lock_replacement text := 'PERFORM pg_advisory_xact_lock(hashtextextended(''bb-hh-sync-v2:''||p_household::text,0)); IF p_expected=0 THEN';
BEGIN
 SELECT pg_get_functiondef(to_regprocedure('public.bb_hh_service_patch(uuid,uuid,text,text,jsonb,bigint)')) INTO definition;
 IF definition IS NULL THEN RAISE EXCEPTION 'Apply household sharing SQL first'; END IF;
 IF strpos(definition,replacement)=0 THEN
  IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
   RAISE EXCEPTION 'Household patch changed; review reserved namespace protection';
  END IF;
  definition:=replace(definition,needle,replacement);
 END IF;
 IF strpos(definition,lock_replacement)=0 THEN
  IF length(definition)-length(replace(definition,lock_needle,''))<>length(lock_needle) THEN
   RAISE EXCEPTION 'Household patch changed; review synchronization lock';
  END IF;
  definition:=replace(definition,lock_needle,lock_replacement);
 END IF;
 EXECUTE definition;
END $namespace$;

-- Compare target state, not the whole household/inventory revision. An unrelated
-- day or ingredient must never supersede this target's pending deliberate edit.
CREATE OR REPLACE FUNCTION public.bb_hh_sync_v2_signature(p_household uuid,p_kind text,p_key text)
RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN p_kind='pantry' THEN (
  SELECT md5(jsonb_build_array(s.stock->p_key,s.locations->p_key)::text)
  FROM public.bb_receipt_inventory_scopes s WHERE s.scope_kind='household' AND s.scope_id=p_household
 ) ELSE (
  SELECT md5(coalesce(jsonb_agg(jsonb_build_array(e.section,e.value,e.revision) ORDER BY e.section),'[]'::jsonb)::text)
  FROM public.bb_household_entries e WHERE e.household_id=p_household AND
   ((p_kind='dinner' AND e.entry_key=p_key AND e.section IN ('planned_day','servings')) OR
    (p_kind='setting' AND e.section=split_part(p_key,':',1) AND e.entry_key=substr(p_key,strpos(p_key,':')+1)))
 ) END;
$$;
REVOKE ALL ON FUNCTION public.bb_hh_sync_v2_signature(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_hh_sync_v2_signature(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.bb_hh_service_sync_v2(
 p_actor uuid,p_household uuid,p_action text,p_payload jsonb DEFAULT '{}'::jsonb,p_inventory_allowed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 meta jsonb; op jsonb; target_state jsonb; semantic jsonb; target_value jsonb;
 state_value jsonb; entry_values jsonb; result jsonb; patch_result jsonb;
 inventory public.bb_receipt_inventory_scopes%ROWTYPE;
 clock_value bigint:=0; prune_floor bigint:=0; cutoff bigint; base_clock bigint; op_order bigint;
 operation_id uuid; target_kind text; target_key text; target_row_key text; actual_signature text;
 section_value text; entry_key_value text; meal_revision bigint; serving_revision bigint; setting_revision bigint;
 status_value text; error_value text; mutation_race boolean:=false;
BEGIN
 -- Same household -> verified identity lock order as unlink/account deletion.
 -- Premium and newest-session checks remain at the existing Cloudflare boundary.
 IF p_actor IS NULL OR p_household IS NULL THEN RAISE EXCEPTION 'household_sync_forbidden'; END IF;
 PERFORM h.id FROM public.bb_households h WHERE h.id=p_household AND
  (h.owner_user_id=p_actor OR (h.partner_user_id=p_actor AND h.invite_status='accepted' AND
   EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor AND lower(u.email)=lower(h.partner_email)))) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'household_sync_forbidden'; END IF;
 PERFORM u.id FROM auth.users u WHERE u.id=p_actor AND u.email_confirmed_at IS NOT NULL FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'household_sync_forbidden'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('get','reserve','apply') OR
    jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>4096 OR
    p_inventory_allowed IS NULL THEN RAISE EXCEPTION 'household_sync_invalid'; END IF;
 IF p_action='get' THEN
  IF p_payload<>'{}'::jsonb THEN RAISE EXCEPTION 'household_sync_invalid'; END IF;
 ELSE
  IF p_payload->>'expectedHouseholdId' IS DISTINCT FROM p_household::text OR
     jsonb_typeof(p_payload->'operationId') IS DISTINCT FROM 'string' OR
     p_payload->>'operationId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN RAISE EXCEPTION 'household_sync_invalid'; END IF;
  operation_id:=(p_payload->>'operationId')::uuid;
 END IF;

 -- Metadata is locked before the existing inventory row. Receipt code only
 -- locks its own advisory key and inventory row; it never needs this metadata.
 PERFORM pg_advisory_xact_lock(hashtextextended('bb-hh-sync-v2:'||p_household::text,0));
 IF p_action<>'get' THEN
  INSERT INTO public.bb_household_entries(household_id,section,entry_key,value)
   VALUES(p_household,'kitchen_item','__bb_sync_v2:clock',jsonb_build_object('version',2,'clock',0,'pruneFloor',0))
   ON CONFLICT DO NOTHING;
 END IF;
 SELECT e.value INTO meta FROM public.bb_household_entries e
  WHERE e.household_id=p_household AND e.section='kitchen_item' AND e.entry_key='__bb_sync_v2:clock' FOR UPDATE;
 clock_value:=coalesce((meta->>'clock')::bigint,0);prune_floor:=coalesce((meta->>'pruneFloor')::bigint,0);
 IF p_inventory_allowed THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('bb-receipt:household:'||p_household::text,0));
  SELECT s.* INTO inventory FROM public.bb_receipt_inventory_scopes s
   WHERE s.scope_kind='household' AND s.scope_id=p_household FOR UPDATE;
 END IF;

 IF p_action<>'get' THEN
  SELECT e.value INTO op FROM public.bb_household_entries e WHERE e.household_id=p_household AND
   e.section='kitchen_item' AND e.entry_key='__bb_sync_v2:op:'||operation_id::text;
  IF p_action='reserve' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN
       ('expectedHouseholdId','operationId','baseClock','target','value')) OR
      jsonb_typeof(p_payload->'baseClock') IS DISTINCT FROM 'number' OR
      (p_payload->>'baseClock') !~ '^[0-9]{1,16}$' OR
      jsonb_typeof(p_payload->'target') IS DISTINCT FROM 'object' OR
      (SELECT count(*) FROM jsonb_object_keys(p_payload->'target'))<>2 OR
      EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload->'target') k WHERE k NOT IN ('kind','key')) OR
      jsonb_typeof(p_payload->'target'->'kind') IS DISTINCT FROM 'string' OR
      jsonb_typeof(p_payload->'target'->'key') IS DISTINCT FROM 'string' OR NOT (p_payload ? 'value')
   THEN RAISE EXCEPTION 'household_sync_invalid'; END IF;
   base_clock:=(p_payload->>'baseClock')::bigint;
   IF base_clock>clock_value OR base_clock>9007199254740991 THEN RAISE EXCEPTION 'household_sync_invalid'; END IF;
   target_kind:=p_payload->'target'->>'kind';target_key:=p_payload->'target'->>'key';target_value:=p_payload->'value';
   IF target_kind='dinner' THEN
    IF target_key NOT IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') OR
       jsonb_typeof(target_value) IS DISTINCT FROM 'object' OR
       (SELECT count(*) FROM jsonb_object_keys(target_value))<>2 OR
       EXISTS(SELECT 1 FROM jsonb_object_keys(target_value) k WHERE k NOT IN ('recipeId','servings')) OR
       NOT (target_value ? 'recipeId' AND target_value ? 'servings') OR
       (target_value->'recipeId'<>'null'::jsonb AND (jsonb_typeof(target_value->'recipeId') IS DISTINCT FROM 'string' OR length(target_value->>'recipeId') NOT BETWEEN 1 AND 256)) OR
       (target_value->'servings'<>'null'::jsonb AND (jsonb_typeof(target_value->'servings') IS DISTINCT FROM 'number' OR
        (target_value->>'servings') !~ '^([1-9]|1[0-2])$')) OR
       (target_value->'recipeId'='null'::jsonb AND target_value->'servings'<>'null'::jsonb)
    THEN RAISE EXCEPTION 'household_sync_invalid'; END IF;
   ELSIF target_kind='pantry' THEN
    IF NOT p_inventory_allowed THEN RAISE EXCEPTION 'household_sync_inventory_forbidden'; END IF;
    IF inventory.scope_id IS NULL OR NOT inventory.initialized OR inventory.inventory_revision=0
     THEN RAISE EXCEPTION 'household_sync_initialization_pending'; END IF;
    IF jsonb_typeof(target_value) IS DISTINCT FROM 'object' OR
       (SELECT count(*) FROM jsonb_object_keys(target_value))<>2 OR
       EXISTS(SELECT 1 FROM jsonb_object_keys(target_value) k WHERE k NOT IN ('quantity','location')) OR
       NOT public.bb_receipt_inventory_valid_stock(jsonb_build_object(target_key,target_value->'quantity')) OR
       jsonb_typeof(target_value->'location') IS DISTINCT FROM 'string' OR
       target_value->>'location' NOT IN ('cupboard','fridge','freezer')
    THEN RAISE EXCEPTION 'household_sync_invalid'; END IF;
   ELSIF target_kind='setting' THEN
    section_value:=split_part(target_key,':',1);entry_key_value:=substr(target_key,strpos(target_key,':')+1);
    IF target_key NOT IN ('household_servings:default','budget_target:weekly') AND
       NOT (section_value='shopping_checked' AND length(entry_key_value) BETWEEN 1 AND 180 AND strpos(target_key,':')>0 AND
        NOT starts_with(entry_key_value,'__bb_sync_v2:')) THEN RAISE EXCEPTION 'household_sync_invalid'; END IF;
    IF target_value<>'{"deleted":true}'::jsonb AND
      ((section_value='household_servings' AND (jsonb_typeof(target_value) IS DISTINCT FROM 'object' OR
         (SELECT count(*) FROM jsonb_object_keys(target_value))<>1 OR jsonb_typeof(target_value->'count') IS DISTINCT FROM 'number' OR
         (target_value->>'count') !~ '^([1-9]|1[0-2])$')) OR
       (section_value='budget_target' AND (jsonb_typeof(target_value) IS DISTINCT FROM 'object' OR
         (SELECT count(*) FROM jsonb_object_keys(target_value))<>1 OR jsonb_typeof(target_value->'amount') IS DISTINCT FROM 'number' OR
         (target_value->>'amount') !~ '^[0-9]+(\.[0-9]+)?$' OR (target_value->>'amount')::numeric NOT BETWEEN 1 AND 10000)) OR
       (section_value='shopping_checked' AND jsonb_typeof(target_value) IS DISTINCT FROM 'boolean'))
    THEN RAISE EXCEPTION 'household_sync_invalid'; END IF;
   ELSE RAISE EXCEPTION 'household_sync_invalid'; END IF;
   semantic:=jsonb_build_object('actor',p_actor::text,'baseClock',base_clock,'target',p_payload->'target','value',target_value);
   IF op IS NOT NULL THEN
    IF op->'intent'<>semantic THEN RAISE EXCEPTION 'household_sync_identity_mismatch'; END IF;
   ELSIF base_clock<prune_floor THEN
    op:=jsonb_build_object('id',operation_id,'order',NULL,'status','expired');
   END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('expectedHouseholdId','operationId','order')) OR
      jsonb_typeof(p_payload->'order') IS DISTINCT FROM 'number' OR
      (p_payload->>'order') !~ '^[0-9]{1,16}$' OR (p_payload->>'order')::bigint NOT BETWEEN 1 AND 9007199254740991
   THEN RAISE EXCEPTION 'household_sync_invalid'; END IF;
   IF op IS NULL THEN op:=jsonb_build_object('id',operation_id,'order',NULL,'status','expired');
   ELSIF op->'intent'->>'actor' IS DISTINCT FROM p_actor::text OR op->>'order' IS DISTINCT FROM p_payload->>'order'
    THEN RAISE EXCEPTION 'household_sync_identity_mismatch'; END IF;
   IF op ? 'intent' THEN
    target_kind:=op->'intent'->'target'->>'kind';target_key:=op->'intent'->'target'->>'key';target_value:=op->'intent'->'value';
    IF target_kind='pantry' THEN
     IF NOT p_inventory_allowed THEN RAISE EXCEPTION 'household_sync_inventory_forbidden'; END IF;
     IF inventory.scope_id IS NULL OR NOT inventory.initialized OR inventory.inventory_revision=0
      THEN RAISE EXCEPTION 'household_sync_initialization_pending'; END IF;
    END IF;
   END IF;
  END IF;

  -- Lock extant target leaves before checking their signature. Missing leaves
  -- are protected at apply by the existing CAS; a concurrent insertion rolls
  -- back both dinner leaves and is acknowledged as a newer external edit.
  IF op IS NULL OR op->>'status'='reserved' THEN
   IF target_kind='dinner' THEN
    PERFORM e.entry_key FROM public.bb_household_entries e WHERE e.household_id=p_household AND
     e.entry_key=target_key AND e.section IN ('planned_day','servings') ORDER BY e.section FOR UPDATE;
   ELSIF target_kind='setting' THEN
    section_value:=split_part(target_key,':',1);entry_key_value:=substr(target_key,strpos(target_key,':')+1);
    PERFORM e.entry_key FROM public.bb_household_entries e WHERE e.household_id=p_household AND
     e.section=section_value AND e.entry_key=entry_key_value FOR UPDATE;
   END IF;
   target_row_key:='__bb_sync_v2:target:'||encode(sha256(convert_to(target_kind||':'||target_key,'UTF8')),'hex');
   SELECT e.value INTO target_state FROM public.bb_household_entries e WHERE e.household_id=p_household AND
    e.section='kitchen_item' AND e.entry_key=target_row_key;
   actual_signature:=public.bb_hh_sync_v2_signature(p_household,target_kind,target_key);
   IF target_state IS NULL THEN
    target_state:=jsonb_build_object('order',0,'signature',actual_signature);
   ELSIF target_state->>'signature' IS DISTINCT FROM actual_signature THEN
    clock_value:=clock_value+1;
    target_state:=jsonb_build_object('order',clock_value,'signature',actual_signature);
   END IF;

   IF p_action='reserve' AND op IS NULL THEN
    clock_value:=clock_value+1;
    op:=jsonb_build_object('id',operation_id,'order',clock_value,'status','reserved','intent',semantic);
    target_state:=jsonb_set(target_state,'{order}',to_jsonb(clock_value));
    INSERT INTO public.bb_household_entries(household_id,section,entry_key,value)
     VALUES(p_household,'kitchen_item','__bb_sync_v2:op:'||operation_id::text,op);
    -- Retain the latest 1024 complete operation identities. An expired unknown
    -- retry keeps its original baseClock and cannot be revived as a new edit.
    SELECT (e.value->>'order')::bigint INTO cutoff FROM public.bb_household_entries e
     WHERE e.household_id=p_household AND e.section='kitchen_item' AND starts_with(e.entry_key,'__bb_sync_v2:op:')
     ORDER BY (e.value->>'order')::bigint DESC OFFSET 1024 LIMIT 1;
    IF cutoff IS NOT NULL THEN
     DELETE FROM public.bb_household_entries e WHERE e.household_id=p_household AND e.section='kitchen_item' AND
      starts_with(e.entry_key,'__bb_sync_v2:op:') AND (e.value->>'order')::bigint<=cutoff;
     prune_floor:=greatest(prune_floor,cutoff);
    END IF;
   ELSIF p_action='apply' THEN
    op_order:=(op->>'order')::bigint;
    IF op_order<(target_state->>'order')::bigint THEN
     op:=jsonb_set(op,'{status}','"superseded"'::jsonb);
    ELSE
     BEGIN
      IF target_kind='dinner' THEN
       SELECT e.revision INTO meal_revision FROM public.bb_household_entries e WHERE e.household_id=p_household AND e.section='planned_day' AND e.entry_key=target_key;
       SELECT e.revision INTO serving_revision FROM public.bb_household_entries e WHERE e.household_id=p_household AND e.section='servings' AND e.entry_key=target_key;
       patch_result:=public.bb_hh_service_patch(p_actor,p_household,'planned_day',target_key,
        CASE WHEN target_value->'recipeId'='null'::jsonb THEN '{"deleted":true}'::jsonb ELSE jsonb_build_object('recipeId',target_value->'recipeId') END,coalesce(meal_revision,0));
       IF patch_result->>'ok'<>'true' THEN RAISE EXCEPTION 'household_sync_external_race'; END IF;
       patch_result:=public.bb_hh_service_patch(p_actor,p_household,'servings',target_key,
        CASE WHEN target_value->'servings'='null'::jsonb THEN '{"deleted":true}'::jsonb ELSE jsonb_build_object('count',target_value->'servings') END,coalesce(serving_revision,0));
       IF patch_result->>'ok'<>'true' THEN RAISE EXCEPTION 'household_sync_external_race'; END IF;
      ELSIF target_kind='setting' THEN
       SELECT e.revision INTO setting_revision FROM public.bb_household_entries e WHERE e.household_id=p_household AND e.section=section_value AND e.entry_key=entry_key_value;
       patch_result:=public.bb_hh_service_patch(p_actor,p_household,section_value,entry_key_value,target_value,coalesce(setting_revision,0));
       IF patch_result->>'ok'<>'true' THEN RAISE EXCEPTION 'household_sync_external_race'; END IF;
      ELSE
       IF inventory.inventory_revision>=9007199254740991 THEN RAISE EXCEPTION 'household_sync_limit'; END IF;
       UPDATE public.bb_receipt_inventory_scopes SET
        stock=CASE WHEN (target_value->>'quantity')::numeric=0 THEN stock-target_key ELSE jsonb_set(stock,ARRAY[target_key],target_value->'quantity') END,
        locations=CASE WHEN (target_value->>'quantity')::numeric=0 THEN locations-target_key ELSE jsonb_set(locations,ARRAY[target_key],target_value->'location') END,
        inventory_revision=inventory_revision+1,updated_at=now()
        WHERE scope_kind='household' AND scope_id=p_household RETURNING * INTO inventory;
      END IF;
     EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'household_sync_external_race' THEN RAISE; END IF;
      mutation_race:=true;
     END;
     IF mutation_race THEN
      clock_value:=clock_value+1;
      target_state:=jsonb_build_object('order',clock_value,'signature',public.bb_hh_sync_v2_signature(p_household,target_kind,target_key));
      op:=jsonb_set(op,'{status}','"superseded"'::jsonb);
     ELSE
      target_state:=jsonb_build_object('order',op_order,'signature',public.bb_hh_sync_v2_signature(p_household,target_kind,target_key));
      op:=jsonb_set(op,'{status}','"applied"'::jsonb);
     END IF;
    END IF;
    UPDATE public.bb_household_entries SET value=op,revision=revision+1,updated_at=now()
     WHERE household_id=p_household AND section='kitchen_item' AND entry_key='__bb_sync_v2:op:'||operation_id::text;
   END IF;
   INSERT INTO public.bb_household_entries(household_id,section,entry_key,value)
    VALUES(p_household,'kitchen_item',target_row_key,target_state)
    ON CONFLICT(household_id,section,entry_key) DO UPDATE SET value=excluded.value,revision=bb_household_entries.revision+1,updated_at=now();
  END IF;
  IF clock_value>9007199254740991 THEN RAISE EXCEPTION 'household_sync_limit'; END IF;
  UPDATE public.bb_household_entries SET value=jsonb_build_object('version',2,'clock',clock_value,'pruneFloor',prune_floor),revision=revision+1,updated_at=now()
   WHERE household_id=p_household AND section='kitchen_item' AND entry_key='__bb_sync_v2:clock';
 END IF;

 -- Complete weekly projection plus the existing shared settings. Hidden
 -- metadata/legacy pantry channels never enter another device's Kitchen merge.
 SELECT coalesce(jsonb_agg(jsonb_build_object('section',e.section,'entry_key',e.entry_key,'value',e.value,'revision',e.revision,'updated_at',e.updated_at)
  ORDER BY e.section,e.entry_key),'[]'::jsonb) INTO entry_values FROM public.bb_household_entries e WHERE e.household_id=p_household AND
  e.section IN ('planned_day','servings','household_servings','budget_target','shopping_checked');
 state_value:=jsonb_build_object('entries',entry_values);
 IF p_inventory_allowed THEN
  state_value:=state_value||jsonb_build_object('stock',coalesce(inventory.stock,'{}'::jsonb),'locations',coalesce(inventory.locations,'{}'::jsonb),
   'inventoryRevision',coalesce(inventory.inventory_revision,0),'initialized',coalesce(inventory.initialized,false));
 END IF;
 result:=jsonb_build_object('ok',true,'protocol',2,'household_id',p_household,'clock',clock_value,'pruneFloor',prune_floor,'state',state_value);
 IF op IS NOT NULL THEN result:=result||jsonb_build_object('operation',op-'intent'); END IF;
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 error_value:=SQLERRM;
 IF error_value IN ('household_sync_forbidden','household_sync_inventory_forbidden') THEN
  RETURN jsonb_build_object('ok',false,'error',error_value,'forbidden',true);
 ELSIF error_value IN ('household_sync_invalid','household_sync_identity_mismatch') THEN
  RETURN jsonb_build_object('ok',false,'error',error_value,'invalid',true);
 ELSIF error_value='household_sync_initialization_pending' THEN
  RETURN jsonb_build_object('ok',false,'error',error_value,'retryable',true);
 ELSE RETURN jsonb_build_object('ok',false,'error','household_sync_unavailable','retryable',true);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.bb_hh_service_sync_v2(uuid,uuid,text,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_hh_service_sync_v2(uuid,uuid,text,jsonb,boolean) TO service_role;
COMMIT;
