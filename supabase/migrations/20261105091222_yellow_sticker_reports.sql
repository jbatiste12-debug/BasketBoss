-- Community sightings contain no public identity and expire after 90 minutes.
-- One bounded row per verified account / region / selected supermarket chain.
BEGIN;
CREATE OR REPLACE FUNCTION public.bb_yellow_sticker_store_valid(p_region text,p_store text)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT coalesce(CASE
 WHEN p_region='UK' THEN p_store=ANY(ARRAY['waitrose','marks-spencer','iceland','tesco','sainsburys','asda','morrisons','aldi','lidl'])
 WHEN p_region IN ('Guernsey','Jersey') THEN p_store=ANY(ARRAY['waitrose','ci-coop','marks-spencer','alliance','morrisons-daily','iceland'])
 ELSE false END,false) $$;
CREATE TABLE IF NOT EXISTS public.bb_yellow_sticker_reports (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 region text NOT NULL,
 store text NOT NULL,
 last_spotted_at timestamptz,
 last_not_yet_at timestamptz,
 last_reported_at timestamptz NOT NULL,
 recent_requests jsonb NOT NULL DEFAULT '[]'::jsonb,
 PRIMARY KEY(user_id,region,store),
 CHECK(public.bb_yellow_sticker_store_valid(region,store)),
 CHECK(jsonb_typeof(recent_requests)='array' AND jsonb_array_length(recent_requests)<=32),
 CHECK(last_spotted_at IS NOT NULL OR last_not_yet_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS bb_yellow_sticker_reports_store_recent
 ON public.bb_yellow_sticker_reports(region,store,last_spotted_at DESC);
ALTER TABLE public.bb_yellow_sticker_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bb_yellow_sticker_reports FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.bb_yellow_sticker_reports TO service_role;
-- The real Supabase service role bypasses RLS. An explicit service-only policy
-- also keeps isolated Postgres verification representative without granting
-- browser roles any direct access.
DROP POLICY IF EXISTS bb_yellow_sticker_service_only ON public.bb_yellow_sticker_reports;
CREATE POLICY bb_yellow_sticker_service_only ON public.bb_yellow_sticker_reports
 FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.bb_yellow_sticker_snapshot(p_region text,p_store text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE stamp timestamptz:=clock_timestamp(); spotted timestamptz; not_yet timestamptz; reporters integer;
BEGIN
 IF NOT public.bb_yellow_sticker_store_valid(p_region,p_store) THEN
  RETURN jsonb_build_object('ok',false,'error','yellow_sticker_invalid_request');
 END IF;
 SELECT max(last_spotted_at) FILTER(WHERE last_spotted_at>stamp-interval '90 minutes'),
  max(last_not_yet_at) FILTER(WHERE last_not_yet_at>stamp-interval '90 minutes'),
  count(*) FILTER(WHERE last_spotted_at>stamp-interval '90 minutes')
 INTO spotted,not_yet,reporters
 FROM public.bb_yellow_sticker_reports WHERE region=p_region AND store=p_store;
 RETURN jsonb_build_object('ok',true,'region',p_region,'store',p_store,'serverNow',stamp,
  'lastSpottedAt',spotted,'latestNotYetAt',not_yet,'expiresAt',spotted+interval '90 minutes','spottedReports',reporters);
END $$;

CREATE OR REPLACE FUNCTION public.bb_yellow_sticker_report(p_user uuid,p_region text,p_store text,p_status text,p_request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE old public.bb_yellow_sticker_reports%ROWTYPE; prior jsonb; requests jsonb; stamp timestamptz:=clock_timestamp(); retry integer;
BEGIN
 IF p_user IS NULL OR NOT public.bb_yellow_sticker_store_valid(p_region,p_store) OR
  p_status IS NULL OR p_status NOT IN ('spotted','not_yet') OR p_request_id IS NULL OR
  p_request_id !~ '^[A-Za-z0-9:_-]{4,160}$'
 THEN RETURN jsonb_build_object('ok',false,'error','yellow_sticker_invalid_request'); END IF;
 -- Serialize an account's reports before checking cooldown or replay history.
 PERFORM pg_advisory_xact_lock(hashtextextended('bb-yellow:'||p_user::text||':'||p_region||':'||p_store,0));
 stamp:=clock_timestamp();
 SELECT * INTO old FROM public.bb_yellow_sticker_reports WHERE user_id=p_user AND region=p_region AND store=p_store FOR UPDATE;
 SELECT value INTO prior FROM jsonb_array_elements(coalesce(old.recent_requests,'[]'::jsonb)) WHERE value->>'id'=p_request_id LIMIT 1;
 IF prior IS NOT NULL THEN
  IF prior->>'status'<>p_status THEN RETURN jsonb_build_object('ok',false,'error','yellow_sticker_request_conflict'); END IF;
  RETURN public.bb_yellow_sticker_snapshot(p_region,p_store)||jsonb_build_object('duplicate',true);
 END IF;
 retry:=ceil(extract(epoch FROM old.last_reported_at+interval '5 minutes'-stamp));
 IF retry>0 THEN RETURN jsonb_build_object('ok',false,'error','yellow_sticker_cooldown','retryAfterSeconds',retry); END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) INTO requests
  FROM jsonb_array_elements(coalesce(old.recent_requests,'[]'::jsonb)) WITH ORDINALITY AS history(value,ordinal) WHERE ordinal<=31;
 requests:=jsonb_build_array(jsonb_build_object('id',p_request_id,'status',p_status,'at',stamp))||requests;
 INSERT INTO public.bb_yellow_sticker_reports(user_id,region,store,last_spotted_at,last_not_yet_at,last_reported_at,recent_requests)
 VALUES(p_user,p_region,p_store,CASE WHEN p_status='spotted' THEN stamp ELSE old.last_spotted_at END,
  CASE WHEN p_status='not_yet' THEN stamp ELSE old.last_not_yet_at END,stamp,requests)
 ON CONFLICT(user_id,region,store) DO UPDATE SET last_spotted_at=excluded.last_spotted_at,last_not_yet_at=excluded.last_not_yet_at,
  last_reported_at=excluded.last_reported_at,recent_requests=excluded.recent_requests;
 RETURN public.bb_yellow_sticker_snapshot(p_region,p_store)||jsonb_build_object('duplicate',false);
EXCEPTION WHEN foreign_key_violation THEN
 -- A deleted identity cannot resurrect a sighting using an unexpired JWT.
 RETURN jsonb_build_object('ok',false,'error','yellow_sticker_sign_in_required');
END $$;
REVOKE ALL ON FUNCTION public.bb_yellow_sticker_store_valid(text,text),public.bb_yellow_sticker_snapshot(text,text),public.bb_yellow_sticker_report(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_yellow_sticker_store_valid(text,text),public.bb_yellow_sticker_snapshot(text,text),public.bb_yellow_sticker_report(uuid,text,text,text,text) TO service_role;
COMMIT;
