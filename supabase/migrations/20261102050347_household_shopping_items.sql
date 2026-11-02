-- Shared shopping additions use the existing verified BasketBoss household.
-- No stock/billing writes. Browser roles have no direct table/RPC access.
BEGIN;
CREATE TABLE IF NOT EXISTS public.bb_household_shopping_items (
 household_id uuid NOT NULL REFERENCES public.bb_households(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 70 AND name !~ '[[:cntrl:]]'),
 quantity numeric NOT NULL CHECK (quantity>0 AND quantity<=1000000 AND scale(quantity)<=6),
 unit text NOT NULL CHECK (unit IN ('g','kg','ml','l','each','pack','clove','tin','loaf','slice','bulb')),
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 added_by_name text CHECK (added_by_name IS NULL OR char_length(added_by_name) BETWEEN 1 AND 60),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 completed boolean NOT NULL DEFAULT false,
 completed_at timestamptz,
 completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>=1),
 PRIMARY KEY(household_id,id),
 CONSTRAINT bb_hh_shop_pack_whole CHECK (unit<>'pack' OR quantity=trunc(quantity)),
 CONSTRAINT bb_hh_shop_attribution_shape CHECK ((created_by IS NULL AND added_by_name IS NULL) OR (created_by IS NOT NULL AND added_by_name IS NOT NULL)),
 CONSTRAINT bb_hh_shop_completion_shape CHECK ((completed AND completed_at IS NOT NULL) OR (NOT completed AND completed_at IS NULL AND completed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS bb_hh_shop_active ON public.bb_household_shopping_items(household_id,completed,created_at,id);
CREATE INDEX IF NOT EXISTS bb_hh_shop_creator ON public.bb_household_shopping_items(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS bb_hh_shop_completer ON public.bb_household_shopping_items(completed_by) WHERE completed_by IS NOT NULL;
ALTER TABLE public.bb_household_shopping_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bb_household_shopping_items FROM PUBLIC,anon,authenticated;
-- Service RPCs run with the migration owner; no direct service table grant is needed.

CREATE OR REPLACE FUNCTION public.bb_hh_shopping_forget_creator()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.created_by IS NULL THEN NEW.added_by_name:=NULL; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bb_hh_shopping_forget_creator() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS bb_hh_shopping_forget_creator ON public.bb_household_shopping_items;
CREATE TRIGGER bb_hh_shopping_forget_creator BEFORE UPDATE OF created_by ON public.bb_household_shopping_items
 FOR EACH ROW EXECUTE FUNCTION public.bb_hh_shopping_forget_creator();

-- Same lock order as household unlink and account deletion: household, then
-- verified auth identity. A stale bearer cannot resurrect a deleted account.
CREATE OR REPLACE FUNCTION public.bb_hh_shopping_member(p_actor uuid,p_household uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE label text;
BEGIN
 IF p_actor IS NULL OR p_household IS NULL THEN RAISE EXCEPTION 'membership_required' USING ERRCODE='42501'; END IF;
 PERFORM h.id FROM public.bb_households h WHERE h.id=p_household AND
  (h.owner_user_id=p_actor OR (h.partner_user_id=p_actor AND h.invite_status='accepted')) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'membership_required' USING ERRCODE='42501'; END IF;
 -- Profile metadata is presentation only. Membership never uses JWT/user metadata.
 SELECT coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'),''),
  nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(u.raw_user_meta_data->>'name'),''),
  nullif(split_part(u.email,'@',1),''),'Household member') INTO label
  FROM auth.users u WHERE u.id=p_actor AND u.email_confirmed_at IS NOT NULL FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'verified_identity_required' USING ERRCODE='42501'; END IF;
 label:=left(btrim(regexp_replace(regexp_replace(label,'[[:cntrl:]<>]',' ','g'),'[[:space:]]+',' ','g')),60);
 RETURN coalesce(nullif(label,''),'Household member');
END $$;
REVOKE ALL ON FUNCTION public.bb_hh_shopping_member(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_hh_shopping_member(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.bb_hh_service_shopping_list(p_actor uuid,p_household uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE items jsonb; n bigint;
BEGIN
 PERFORM public.bb_hh_shopping_member(p_actor,p_household);
 WITH pending AS (SELECT * FROM public.bb_household_shopping_items WHERE household_id=p_household AND NOT completed),
 recent AS (SELECT * FROM public.bb_household_shopping_items WHERE household_id=p_household AND completed ORDER BY completed_at DESC,id DESC LIMIT 50)
 SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.completed ASC,i.created_at ASC,i.id),'[]'::jsonb)
 INTO items FROM (SELECT * FROM pending UNION ALL SELECT * FROM recent) i;
 SELECT count(*) INTO n FROM public.bb_household_shopping_items WHERE household_id=p_household AND completed;
 RETURN jsonb_build_object('ok',true,'household_id',p_household,'items',items,'history_limit',50,'history_has_more',n>50);
END $$;
REVOKE ALL ON FUNCTION public.bb_hh_service_shopping_list(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_hh_service_shopping_list(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.bb_hh_service_shopping_add(
 p_actor uuid,p_household uuid,p_id uuid,p_name text,p_quantity numeric,p_unit text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.bb_household_shopping_items%ROWTYPE; label text; clean_name text:=btrim(p_name);
BEGIN
 IF p_id IS NULL OR clean_name IS NULL OR char_length(clean_name) NOT BETWEEN 1 AND 70 OR clean_name ~ '[[:cntrl:]]' OR
  p_quantity IS NULL OR p_quantity<=0 OR p_quantity>1000000 OR scale(p_quantity)>6 OR
  p_unit IS NULL OR p_unit NOT IN ('g','kg','ml','l','each','pack','clove','tin','loaf','slice','bulb') OR
  (p_unit='pack' AND p_quantity<>trunc(p_quantity))
 THEN RAISE EXCEPTION 'invalid_shopping_addition' USING ERRCODE='22023'; END IF;
 label:=public.bb_hh_shopping_member(p_actor,p_household);
 SELECT * INTO item FROM public.bb_household_shopping_items WHERE household_id=p_household AND id=p_id;
 IF FOUND THEN
  IF item.created_by IS DISTINCT FROM p_actor OR item.name IS DISTINCT FROM clean_name OR item.quantity IS DISTINCT FROM p_quantity OR item.unit IS DISTINCT FROM p_unit THEN
   RETURN jsonb_build_object('ok',false,'conflict',true,'household_id',p_household,'item',to_jsonb(item));
  END IF;
  -- Retrying an acknowledged addition never resets a later completion.
  RETURN jsonb_build_object('ok',true,'idempotent',true,'household_id',p_household,'item',to_jsonb(item));
 END IF;
 IF (SELECT count(*) FROM public.bb_household_shopping_items WHERE household_id=p_household AND NOT completed)>=200 THEN
  RETURN jsonb_build_object('ok',false,'limit_reached',true,'household_id',p_household);
 END IF;
 INSERT INTO public.bb_household_shopping_items(household_id,id,name,quantity,unit,created_by,added_by_name)
 VALUES(p_household,p_id,clean_name,p_quantity,p_unit,p_actor,label) RETURNING * INTO item;
 RETURN jsonb_build_object('ok',true,'idempotent',false,'household_id',p_household,'item',to_jsonb(item));
END $$;
REVOKE ALL ON FUNCTION public.bb_hh_service_shopping_add(uuid,uuid,uuid,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_hh_service_shopping_add(uuid,uuid,uuid,text,numeric,text) TO service_role;

CREATE OR REPLACE FUNCTION public.bb_hh_service_shopping_complete(
 p_actor uuid,p_household uuid,p_id uuid,p_expected bigint,p_completed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.bb_household_shopping_items%ROWTYPE;
BEGIN
 IF p_id IS NULL OR p_expected IS NULL OR p_expected<1 OR p_completed IS NULL
 THEN RAISE EXCEPTION 'invalid_shopping_completion' USING ERRCODE='22023'; END IF;
 PERFORM public.bb_hh_shopping_member(p_actor,p_household);
 SELECT * INTO item FROM public.bb_household_shopping_items WHERE household_id=p_household AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'not_found',true,'household_id',p_household); END IF;
 IF item.completed=p_completed THEN
  RETURN jsonb_build_object('ok',true,'idempotent',true,'household_id',p_household,'item',to_jsonb(item));
 END IF;
 IF item.revision<>p_expected THEN
  RETURN jsonb_build_object('ok',false,'conflict',true,'household_id',p_household,'item',to_jsonb(item));
 END IF;
 UPDATE public.bb_household_shopping_items SET completed=p_completed,
  completed_at=CASE WHEN p_completed THEN now() ELSE NULL END,
  completed_by=CASE WHEN p_completed THEN p_actor ELSE NULL END,
  revision=revision+1,updated_at=now()
 WHERE household_id=p_household AND id=p_id RETURNING * INTO item;
 RETURN jsonb_build_object('ok',true,'idempotent',false,'household_id',p_household,'item',to_jsonb(item));
END $$;
REVOKE ALL ON FUNCTION public.bb_hh_service_shopping_complete(uuid,uuid,uuid,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_hh_service_shopping_complete(uuid,uuid,uuid,bigint,boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
