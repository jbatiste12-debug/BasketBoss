-- BasketBoss Household Partner Sharing v1 (2026-10-29)
-- Execute in the CORRECT Supabase project as the database owner.
-- Does not modify basketboss_data, auth, Paddle, D1, or existing customer rows.
-- CRITICAL: this schema is intentionally CLOSED to client-side writes.
-- Only authenticated Cloudflare Functions, after verifying an active D1 Premium
-- entitlement and a confirmed Supabase identity, may call service RPCs with
-- a Supabase server-only service-role key. No key belongs in public JS.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.bb_households (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
 partner_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
 partner_email text,
 invite_status text NOT NULL DEFAULT 'none' CHECK (invite_status IN ('none','pending','accepted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT bb_hh_not_self CHECK (partner_user_id IS NULL OR partner_user_id<>owner_user_id),
 CONSTRAINT bb_hh_status_shape CHECK (
   (invite_status='none' AND partner_user_id IS NULL AND partner_email IS NULL) OR
   (invite_status='pending' AND partner_user_id IS NULL AND partner_email IS NOT NULL) OR
   (invite_status='accepted' AND partner_email IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.bb_household_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 household_id uuid NOT NULL UNIQUE REFERENCES public.bb_households(id) ON DELETE CASCADE,
 partner_email text NOT NULL,
 status text NOT NULL CHECK (status IN ('pending','accepted','revoked')),
 accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bb_hh_invites_lookup ON public.bb_household_invites(lower(partner_email),status,expires_at);
CREATE TABLE IF NOT EXISTS public.bb_household_entries (
 household_id uuid NOT NULL REFERENCES public.bb_households(id) ON DELETE CASCADE,
 section text NOT NULL CHECK (section IN ('planned_day','servings','pantry_item','kitchen_item','shopping_checked','budget_target','household_servings')),
 entry_key text NOT NULL CHECK (length(entry_key) BETWEEN 1 AND 180),
 value jsonb NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK (revision>=1),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 PRIMARY KEY(household_id,section,entry_key),
 CONSTRAINT bb_hh_entry_size CHECK (octet_length(value::text)<=8192)
);
CREATE INDEX IF NOT EXISTS bb_hh_entries_updated ON public.bb_household_entries(household_id,updated_at);

CREATE OR REPLACE FUNCTION public.bb_hh_is_member(p_household uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.bb_households h
  WHERE h.id=p_household AND auth.uid() IS NOT NULL AND
    (h.owner_user_id=auth.uid() OR
     (h.partner_user_id=auth.uid() AND h.invite_status='accepted')));
$$;
REVOKE ALL ON FUNCTION public.bb_hh_is_member(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bb_hh_is_member(uuid) TO authenticated;

ALTER TABLE public.bb_households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bb_household_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bb_household_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bb_hh_read ON public.bb_households;
CREATE POLICY bb_hh_read ON public.bb_households FOR SELECT TO authenticated
 USING (public.bb_hh_is_member(id));
DROP POLICY IF EXISTS bb_hh_invite_owner_read ON public.bb_household_invites;
CREATE POLICY bb_hh_invite_owner_read ON public.bb_household_invites FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.bb_households h
   WHERE h.id=household_id AND h.owner_user_id=auth.uid()));
DROP POLICY IF EXISTS bb_hh_entries_member_read ON public.bb_household_entries;
CREATE POLICY bb_hh_entries_member_read ON public.bb_household_entries FOR SELECT TO authenticated
 USING (public.bb_hh_is_member(household_id));
-- No INSERT, UPDATE, or DELETE policies. Read access does not imply write access.
REVOKE ALL ON public.bb_households,public.bb_household_invites,public.bb_household_entries FROM anon,authenticated;
-- Defense in depth: RLS defines eligible identities, but there is NO direct
-- table grant to browser clients. This is important because the authoritative
-- Premium subscription can be cancelled in Cloudflare D1, not Supabase.
-- Every read still goes through /api/household and rechecks D1 entitlement.

-- Server-only operation: invitation has one UNIQUE row per household, preventing
-- multiple simultaneous partners even under concurrent requests.
CREATE OR REPLACE FUNCTION public.bb_hh_service_invite(p_owner uuid,p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.bb_households%ROWTYPE; e text:=lower(btrim(p_email));
BEGIN
 IF p_owner IS NULL OR e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR length(e)>254
   THEN RAISE EXCEPTION 'invalid_owner_or_email' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner AND lower(email)=e)
   THEN RAISE EXCEPTION 'cannot_invite_self' USING ERRCODE='22023'; END IF;
 INSERT INTO public.bb_households(owner_user_id) VALUES(p_owner)
   ON CONFLICT(owner_user_id) DO NOTHING;
 SELECT * INTO h FROM public.bb_households WHERE owner_user_id=p_owner FOR UPDATE;
 IF h.partner_user_id IS NOT NULL
   THEN RAISE EXCEPTION 'unlink_current_partner_first' USING ERRCODE='23505'; END IF;
 UPDATE public.bb_households SET partner_email=e,invite_status='pending',updated_at=now()
   WHERE id=h.id;
 INSERT INTO public.bb_household_invites(household_id,partner_email,status,expires_at)
   VALUES(h.id,e,'pending',now()+interval '7 days')
   ON CONFLICT(household_id) DO UPDATE SET partner_email=excluded.partner_email,
     status='pending',accepted_by=NULL,expires_at=excluded.expires_at,updated_at=now();
 RETURN jsonb_build_object('household_id',h.id,'status','pending','partner_email',e);
END $$;

CREATE OR REPLACE FUNCTION public.bb_hh_service_accept(p_user uuid,p_email text,p_household uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.bb_households%ROWTYPE; inv public.bb_household_invites%ROWTYPE; e text:=lower(btrim(p_email));
BEGIN
 IF p_user IS NULL OR p_household IS NULL OR e='' THEN RAISE EXCEPTION 'invalid_accept' USING ERRCODE='22023'; END IF;
 -- Enforce confirmed email identity INSIDE Postgres as a second layer,
 -- not only in the Cloudflare bearer-token check.
 IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p_user
   AND u.email_confirmed_at IS NOT NULL AND lower(u.email)=e) THEN
   RAISE EXCEPTION 'verified_email_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM public.bb_households WHERE id=p_household FOR UPDATE;
 SELECT * INTO inv FROM public.bb_household_invites WHERE household_id=p_household FOR UPDATE;
 IF h.id IS NULL OR inv.id IS NULL OR inv.status<>'pending' OR inv.expires_at<=now()
    OR lower(inv.partner_email)<>e OR p_user=h.owner_user_id OR h.partner_user_id IS NOT NULL
    THEN RAISE EXCEPTION 'invite_not_eligible' USING ERRCODE='42501'; END IF;
 -- The server MUST have authenticated p_user with Supabase /auth/v1/user,
 -- required email_confirmed_at, and compared that verified email to p_email.
 UPDATE public.bb_households SET partner_user_id=p_user,partner_email=e,
  invite_status='accepted',updated_at=now() WHERE id=p_household;
 UPDATE public.bb_household_invites SET status='accepted',accepted_by=p_user,
  updated_at=now() WHERE id=inv.id;
 RETURN jsonb_build_object('household_id',h.id,'status','accepted');
END $$;

CREATE OR REPLACE FUNCTION public.bb_hh_service_unlink(p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h_id uuid;
BEGIN
 SELECT id INTO h_id FROM public.bb_households WHERE owner_user_id=p_owner FOR UPDATE;
 IF h_id IS NULL THEN RETURN jsonb_build_object('status','none'); END IF;
 UPDATE public.bb_households SET partner_user_id=NULL,partner_email=NULL,
  invite_status='none',updated_at=now() WHERE id=h_id;
 UPDATE public.bb_household_invites SET status='revoked',accepted_by=NULL,
  updated_at=now() WHERE household_id=h_id;
 -- Existing shared entries remain the owner's. No local state is deleted.
 RETURN jsonb_build_object('household_id',h_id,'status','none');
END $$;

-- Compare-and-swap on each independent leaf prevents unrelated changes
-- (e.g. Shop ticks vs Tuesday dinner) from clobbering each other.
-- No silently resolved same-key conflicts: caller receives current entry.
CREATE OR REPLACE FUNCTION public.bb_hh_service_patch(
 p_actor uuid,p_household uuid,p_section text,p_key text,
 p_value jsonb,p_expected bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
 -- Validate section values even when the backend caller is authenticated;
 -- malformed shared state must never be saved for another device to ingest.
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
 IF NOT EXISTS(SELECT 1 FROM public.bb_households h WHERE h.id=p_household
  AND (h.owner_user_id=p_actor OR (h.partner_user_id=p_actor AND h.invite_status='accepted')))
 THEN RAISE EXCEPTION 'membership_required' USING ERRCODE='42501'; END IF;
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

-- Never expose management RPCs to anon or ordinary authenticated clients.
REVOKE ALL ON FUNCTION public.bb_hh_service_invite(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bb_hh_service_accept(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bb_hh_service_unlink(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bb_hh_service_patch(uuid,uuid,text,text,jsonb,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_hh_service_invite(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bb_hh_service_accept(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bb_hh_service_unlink(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bb_hh_service_patch(uuid,uuid,text,text,jsonb,bigint) TO service_role;
COMMIT;
