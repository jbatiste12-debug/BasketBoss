-- Pantry balances may contain partial eggs, produce or packs after a cooked meal.
-- Receipt purchase counts keep their original integer validation. No rows are rewritten.
-- Apply after receipt_auto_stock_policy; deploy the matching API/client afterwards.
BEGIN;

CREATE OR REPLACE FUNCTION public.bb_receipt_inventory_valid_stock(p_stock jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE e record; q numeric; food text; unit_name text;
BEGIN
 IF jsonb_typeof(p_stock) IS DISTINCT FROM 'object' OR
    octet_length(p_stock::text)>524288 OR
    (SELECT count(*) FROM jsonb_object_keys(p_stock))>2000 THEN RETURN false; END IF;
 FOR e IN SELECT key,value FROM jsonb_each(p_stock) LOOP
  IF length(e.key)>180 OR e.key !~ '^[^|]{1,160}\|(g|ml|tsp|tbsp|each|clove|bulb|tin|pack|bag|bunch|loaf|slice)$' OR
     e.key ~ '[[:cntrl:]]' OR jsonb_typeof(e.value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  food:=split_part(e.key,'|',1); unit_name:=split_part(e.key,'|',2);
  IF food<>lower(btrim(food)) OR food IN ('__proto__','constructor','prototype') OR
     public.bb_receipt_inventory_is_household(food) THEN RETURN false; END IF;
  q:=(e.value #>> '{}')::numeric;
  IF q<0 OR q>1000000 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.bb_receipt_inventory_valid_stock(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.bb_receipt_inventory_valid_purchase(p_stock jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE e record; q numeric; food text; unit_name text;
BEGIN
 IF jsonb_typeof(p_stock) IS DISTINCT FROM 'object' OR
    octet_length(p_stock::text)>524288 OR
    (SELECT count(*) FROM jsonb_object_keys(p_stock))>2000 THEN RETURN false; END IF;
 FOR e IN SELECT key,value FROM jsonb_each(p_stock) LOOP
  IF length(e.key)>180 OR e.key !~ '^[^|]{1,160}\|(g|ml|tsp|tbsp|each|clove|bulb|tin|pack|bag|bunch|loaf|slice)$' OR
     e.key ~ '[[:cntrl:]]' OR jsonb_typeof(e.value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  food:=split_part(e.key,'|',1); unit_name:=split_part(e.key,'|',2);
  IF food<>lower(btrim(food)) OR food IN ('__proto__','constructor','prototype') OR
     public.bb_receipt_inventory_is_household(food) THEN RETURN false; END IF;
  q:=(e.value #>> '{}')::numeric;
  IF q<0 OR q>1000000 OR round(q,3)<>q OR
     (unit_name NOT IN ('g','ml','tsp','tbsp') AND trunc(q)<>q) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.bb_receipt_inventory_valid_purchase(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.bb_receipt_inventory_service(
 p_actor uuid,p_scope_kind text,p_scope_id uuid,p_action text,
 p_request_id text DEFAULT NULL,p_receipt_id text DEFAULT NULL,p_payload_hash text DEFAULT NULL,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.bb_receipt_inventory_scopes%ROWTYPE; old_receipt public.bb_receipt_inventory_receipts%ROWTYPE;
 request_receipt public.bb_receipt_inventory_receipts%ROWTYPE; e record; line jsonb; adj jsonb; observation jsonb;
 stock_value jsonb; locations_value jsonb; baseline jsonb; semantic jsonb; saved_payload jsonb; result jsonb;
 claim_values jsonb:='{}'::jsonb; purchased_values jsonb:='{}'::jsonb; credits jsonb:='[]'::jsonb; normalized_observations jsonb:='[]'::jsonb;
 ids text[]:=ARRAY[]::text[]; line_id text; food_key text; unit_name text; stock_key text; session_id text; v_legacy_id text; kind_value text;
 quantity_value numeric; credited_value numeric; current_value numeric; amount_value numeric; expected_revision bigint; next_revision bigint;
 food_subtotal numeric:=0; essential_subtotal numeric:=0; adjustment_total numeric:=0; tax_total numeric:=0;
 receipt_total numeric; spending jsonb; error_value text; stock_policy boolean:=true;
BEGIN
 -- Recheck confirmed identity and accepted membership inside PostgreSQL. D1
 -- Premium verification remains the mandatory upstream Cloudflare boundary.
 IF p_actor IS NULL OR p_scope_id IS NULL OR p_scope_kind IS NULL OR p_scope_kind NOT IN ('user','household') OR
    NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor AND u.email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'receipt_scope_forbidden'; END IF;
 IF p_scope_kind='user' THEN
  IF p_scope_id<>p_actor THEN RAISE EXCEPTION 'receipt_scope_forbidden'; END IF;
 ELSE
  -- Lock accepted membership against concurrent unlink. Owners retain their
  -- household inventory after unlink; former partners have no access.
  PERFORM h.id FROM public.bb_households h WHERE h.id=p_scope_id AND
   (h.owner_user_id=p_actor OR (h.invite_status='accepted' AND h.partner_user_id=p_actor AND
    EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor AND lower(u.email)=lower(h.partner_email)))) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'receipt_scope_forbidden'; END IF;
 END IF;
 IF p_action IS NULL OR p_action NOT IN ('get','status','confirm_receipt','confirm_pantry') OR
    NOT public.bb_receipt_inventory_valid_text(p_receipt_id,120,true) OR
    jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>2097152
 THEN RAISE EXCEPTION 'receipt_invalid_request'; END IF;
 -- Serialize even an absent scope, so a GET recovery probe cannot combine an
 -- empty inventory with a receipt concurrently committed on another device.
 PERFORM pg_advisory_xact_lock(hashtextextended('bb-receipt:'||p_scope_kind||':'||p_scope_id::text,0));
 IF p_action IN ('get','status') THEN
  IF p_payload<>'{}'::jsonb THEN RAISE EXCEPTION 'receipt_invalid_request'; END IF;
  result:=public.bb_receipt_inventory_snapshot(p_scope_kind,p_scope_id,p_receipt_id);
  IF p_action='status' THEN result:=result||jsonb_build_object('configured',true,'available',true); END IF;
  RETURN result;
 END IF;

 -- The backend derives authorization scope independently. This client snapshot
 -- is only a compare-and-swap precondition: a household change between review
 -- and confirmation must never redirect an accepted receipt or pantry edit.
 -- Check before even recording a duplicate request alias or seeding a scope.
 IF jsonb_typeof(p_payload->'expectedScope') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'receipt_scope_conflict'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_payload->'expectedScope'))<>2 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload->'expectedScope') k WHERE k NOT IN ('kind','id')) OR
    p_payload->'expectedScope'->'kind' IS DISTINCT FROM to_jsonb(p_scope_kind) OR
    p_payload->'expectedScope'->'id' IS DISTINCT FROM to_jsonb(p_scope_id::text)
 THEN RAISE EXCEPTION 'receipt_scope_conflict'; END IF;

 IF p_action='confirm_receipt' THEN
  IF p_payload ? 'addToPantry' AND jsonb_typeof(p_payload->'addToPantry') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  stock_policy:=coalesce((p_payload->>'addToPantry')::boolean,true);
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN
   ('action','addToPantry','requestId','receiptId','shopSessionId','market','currency','retailer','purchasedAt','receiptTotal','adjustments','inventoryBaseline','expectedScope','lines','priceObservations'))
  THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF NOT public.bb_receipt_inventory_valid_text(p_request_id,160,false) OR p_receipt_id IS NULL OR
     p_payload_hash IS NULL OR p_payload_hash !~ '^[a-f0-9]{64}$' OR
     jsonb_typeof(p_payload->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'receiptId') IS DISTINCT FROM 'string' OR
     p_payload->>'requestId' IS DISTINCT FROM p_request_id OR p_payload->>'receiptId' IS DISTINCT FROM p_receipt_id OR
     p_payload->>'action' IS DISTINCT FROM 'confirm_receipt'
  THEN RAISE EXCEPTION 'receipt_invalid_request'; END IF;
  semantic:=p_payload-'inventoryBaseline'-'expectedScope'-'requestId'-'priceObservations';
  SELECT * INTO old_receipt FROM public.bb_receipt_inventory_receipts WHERE scope_kind=p_scope_kind AND scope_id=p_scope_id AND receipt_id=p_receipt_id;
  SELECT t.* INTO request_receipt FROM public.bb_receipt_inventory_receipts t
   JOIN public.bb_receipt_inventory_requests q ON q.scope_kind=t.scope_kind AND q.scope_id=t.scope_id AND q.receipt_id=t.receipt_id
   WHERE q.scope_kind=p_scope_kind AND q.scope_id=p_scope_id AND q.request_id=p_request_id;
  IF request_receipt.receipt_id IS NOT NULL AND request_receipt.receipt_id<>p_receipt_id THEN RAISE EXCEPTION 'receipt_identity_conflict'; END IF;
  IF old_receipt.receipt_id IS NOT NULL THEN
   IF old_receipt.payload_hash<>p_payload_hash OR old_receipt.semantic_payload<>semantic THEN RAISE EXCEPTION 'receipt_identity_conflict'; END IF;
   -- A retry may choose a new transport key. Reserve that alias as well, while
   -- leaving the original receipt, full pantry baseline and revision untouched.
   INSERT INTO public.bb_receipt_inventory_requests(scope_kind,scope_id,request_id,receipt_id,payload_hash)
    VALUES(p_scope_kind,p_scope_id,p_request_id,p_receipt_id,p_payload_hash)
    ON CONFLICT(scope_kind,scope_id,request_id) DO NOTHING;
   RETURN public.bb_receipt_inventory_snapshot(p_scope_kind,p_scope_id,p_receipt_id)||jsonb_build_object('duplicate',true);
  END IF;
 END IF;

 INSERT INTO public.bb_receipt_inventory_scopes(scope_kind,scope_id,user_id,household_id)
 VALUES(p_scope_kind,p_scope_id,CASE WHEN p_scope_kind='user' THEN p_actor ELSE NULL END,CASE WHEN p_scope_kind='household' THEN p_scope_id ELSE NULL END)
 ON CONFLICT(scope_kind,scope_id) DO NOTHING;
 SELECT * INTO s FROM public.bb_receipt_inventory_scopes WHERE scope_kind=p_scope_kind AND scope_id=p_scope_id FOR UPDATE;
 IF s.inventory_revision>=9007199254740991 THEN RAISE EXCEPTION 'receipt_inventory_limit'; END IF;
 next_revision:=s.inventory_revision+1;
 session_id:=p_payload->>'shopSessionId';
 IF (p_payload ? 'shopSessionId' AND p_payload->'shopSessionId'<>'null'::jsonb AND jsonb_typeof(p_payload->'shopSessionId') IS DISTINCT FROM 'string') OR
    NOT public.bb_receipt_inventory_valid_text(session_id,120,true) THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
 IF p_action='confirm_pantry' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','stock','expectedRevision','expectedScope','shopSessionId')) THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF p_payload->>'action' IS DISTINCT FROM 'confirm_pantry' OR
     jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR
     (p_payload->>'expectedRevision') !~ '^[0-9]+$' OR length(p_payload->>'expectedRevision')>16 OR
     NOT public.bb_receipt_inventory_valid_stock(p_payload->'stock')
  THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  expected_revision:=(p_payload->>'expectedRevision')::bigint;
  IF expected_revision>9007199254740991 THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF expected_revision<>s.inventory_revision THEN RAISE EXCEPTION 'receipt_revision_conflict'; END IF;
  SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO stock_value FROM jsonb_each(p_payload->'stock') WHERE (value #>> '{}')::numeric>0;
  SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO locations_value FROM jsonb_each(s.locations)
   WHERE stock_value ? key AND value IN ('"cupboard"'::jsonb,'"fridge"'::jsonb,'"freezer"'::jsonb);
  UPDATE public.bb_receipt_inventory_scopes SET stock=stock_value,locations=locations_value,initialized=true,inventory_revision=next_revision,
   pantry_review_required=false,pantry_shop_session_id=session_id,pantry_confirmed_at=now(),updated_at=now()
   WHERE scope_kind=p_scope_kind AND scope_id=p_scope_id;
  RETURN public.bb_receipt_inventory_snapshot(p_scope_kind,p_scope_id,NULL);
 END IF;

 baseline:=p_payload->'inventoryBaseline';
 IF jsonb_typeof(baseline) IS DISTINCT FROM 'object' OR NOT public.bb_receipt_inventory_valid_stock(baseline->'stock') OR
    jsonb_typeof(baseline->'expectedRevision') IS DISTINCT FROM 'number' OR
    (baseline->>'expectedRevision') !~ '^[0-9]+$' OR length(baseline->>'expectedRevision')>16 OR
    jsonb_typeof(baseline->'initialize') IS DISTINCT FROM 'boolean'
 THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(baseline) k WHERE k NOT IN ('stock','expectedRevision','initialize')) THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
 expected_revision:=(baseline->>'expectedRevision')::bigint;
 IF expected_revision>9007199254740991 THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
 IF expected_revision<>s.inventory_revision THEN RAISE EXCEPTION 'receipt_revision_conflict'; END IF;
 IF (baseline->>'initialize')::boolean=s.initialized THEN RAISE EXCEPTION 'receipt_initialization_conflict'; END IF;
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO stock_value FROM jsonb_each(baseline->'stock') WHERE (value #>> '{}')::numeric>0;
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO locations_value FROM jsonb_each(s.locations)
  WHERE stock_value ? key AND value IN ('"cupboard"'::jsonb,'"fridge"'::jsonb,'"freezer"'::jsonb);
 IF jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'lines') NOT BETWEEN 1 AND 200 OR
    jsonb_typeof(p_payload->'adjustments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'adjustments')>200 OR
    jsonb_array_length(p_payload->'lines')+jsonb_array_length(p_payload->'adjustments')>200 OR
    jsonb_typeof(p_payload->'market') IS DISTINCT FROM 'string' OR p_payload->>'market' NOT IN ('UK','Guernsey','Jersey','US') OR
    p_payload->>'currency' IS DISTINCT FROM (CASE WHEN p_payload->>'market'='US' THEN 'USD' ELSE 'GBP' END) OR
    (p_payload->'retailer'<>'null'::jsonb AND jsonb_typeof(p_payload->'retailer') IS DISTINCT FROM 'string') OR
    (p_payload->'purchasedAt'<>'null'::jsonb AND jsonb_typeof(p_payload->'purchasedAt') IS DISTINCT FROM 'string') OR
    NOT public.bb_receipt_inventory_valid_text(p_payload->>'retailer',100,true) OR
    NOT public.bb_receipt_inventory_valid_text(p_payload->>'purchasedAt',50,true)
 THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
 IF p_payload->'receiptTotal' IS DISTINCT FROM 'null'::jsonb THEN
  IF jsonb_typeof(p_payload->'receiptTotal') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  receipt_total:=(p_payload->>'receiptTotal')::numeric;
  IF abs(receipt_total)>100000 OR round(receipt_total,2)<>receipt_total THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
 END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
  line_id:=line->>'lineId';kind_value:=line->>'kind';
  IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR NOT public.bb_receipt_inventory_valid_text(line_id,100,false) OR line_id=ANY(ids) OR
     jsonb_typeof(line->'lineId') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'name') IS DISTINCT FROM 'string' OR
     NOT public.bb_receipt_inventory_valid_text(line->>'name',200,false) OR jsonb_typeof(line->'kind') IS DISTINCT FROM 'string' OR kind_value NOT IN ('food','essential') OR
     jsonb_typeof(line->'pricePaid') IS DISTINCT FROM 'number' OR
     jsonb_typeof(line->'priceType') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'location') IS DISTINCT FROM 'string' OR
     line->>'priceType' NOT IN ('regular','promotion','unknown') OR line->>'location' NOT IN ('cupboard','fridge','freezer')
  THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(line) k WHERE k NOT IN
   ('lineId','kind','canonicalKey','name','brand','quantity','unit','packCount','packQuantity','packUnit','pricePaid','priceType','location','legacyCredit'))
  THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF (line->>'name') ~* '\m(refund|returned|discount|coupon|voucher|subtotal|tax|vat)\M' THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF jsonb_typeof(line->'brand') IS DISTINCT FROM 'string' OR (line->>'brand'<>'' AND NOT public.bb_receipt_inventory_valid_text(line->>'brand',80,false)) THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF (line->'quantity'<>'null'::jsonb AND (jsonb_typeof(line->'quantity') IS DISTINCT FROM 'number' OR (line->>'quantity')::numeric<=0 OR (line->>'quantity')::numeric>1000000)) OR
     (line->'packQuantity'<>'null'::jsonb AND (jsonb_typeof(line->'packQuantity') IS DISTINCT FROM 'number' OR (line->>'packQuantity')::numeric<=0 OR (line->>'packQuantity')::numeric>1000000)) OR
     (line->'packCount'<>'null'::jsonb AND (jsonb_typeof(line->'packCount') IS DISTINCT FROM 'number' OR (line->>'packCount')::numeric NOT BETWEEN 1 AND 10000 OR trunc((line->>'packCount')::numeric)<>(line->>'packCount')::numeric))
  THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  ids:=array_append(ids,line_id);amount_value:=(line->>'pricePaid')::numeric;
  IF amount_value<0 OR amount_value>100000 OR round(amount_value,2)<>amount_value THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF kind_value='essential' THEN
   IF line->'canonicalKey' IS DISTINCT FROM 'null'::jsonb OR line ? 'legacyCredit' THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
   IF line->'quantity'<>'null'::jsonb AND (jsonb_typeof(line->'unit') IS DISTINCT FROM 'string' OR
      NOT public.bb_receipt_inventory_valid_purchase(jsonb_build_object('receipt quantity|'||(line->>'unit'),(line->>'quantity')::numeric)))
   THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
   essential_subtotal:=essential_subtotal+amount_value;
   CONTINUE;
  END IF;
  food_key:=line->>'canonicalKey';unit_name:=line->>'unit';stock_key:=food_key||'|'||unit_name;
  IF jsonb_typeof(line->'canonicalKey') IS DISTINCT FROM 'string' OR
     NOT public.bb_receipt_inventory_valid_text(food_key,160,false) OR food_key<>lower(food_key) OR food_key LIKE '%|%' OR
     food_key IN ('__proto__','constructor','prototype') OR public.bb_receipt_inventory_is_household(line->>'name')
  THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF NOT stock_policy THEN
   IF line ? 'legacyCredit' THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
   food_subtotal:=food_subtotal+amount_value;
   CONTINUE;
  END IF;
  IF jsonb_typeof(line->'quantity') IS DISTINCT FROM 'number' OR jsonb_typeof(line->'canonicalKey') IS DISTINCT FROM 'string' OR
     jsonb_typeof(line->'unit') IS DISTINCT FROM 'string' OR food_key IS NULL OR unit_name IS NULL THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  quantity_value:=(line->>'quantity')::numeric;
  IF quantity_value<=0 OR NOT public.bb_receipt_inventory_valid_purchase(jsonb_build_object(stock_key,quantity_value)) THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF line->'packQuantity'<>'null'::jsonb AND line->'packCount'<>'null'::jsonb THEN
   IF line->>'packUnit' IS DISTINCT FROM unit_name OR
      (line->>'packQuantity')::numeric*(line->>'packCount')::numeric<>quantity_value
   THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  END IF;
  IF public.bb_receipt_inventory_is_household(line->>'name') THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  purchased_values:=purchased_values||jsonb_build_object(stock_key,coalesce((purchased_values->>stock_key)::numeric,0)+quantity_value);
  IF (purchased_values->>stock_key)::numeric>1000000 THEN RAISE EXCEPTION 'receipt_inventory_limit'; END IF;
  credited_value:=0;
  IF line ? 'legacyCredit' THEN
   v_legacy_id:=line->'legacyCredit'->>'id';
   IF session_id IS NULL OR v_legacy_id IS DISTINCT FROM session_id||'|'||stock_key OR
      line->'legacyCredit'->>'unit' IS DISTINCT FROM unit_name OR jsonb_typeof(line->'legacyCredit'->'quantity') IS DISTINCT FROM 'number'
   THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
   credited_value:=(line->'legacyCredit'->>'quantity')::numeric;
   IF credited_value<=0 OR credited_value>quantity_value OR round(credited_value,3)<>credited_value OR
      (unit_name NOT IN ('g','ml') AND trunc(credited_value)<>credited_value) THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
   IF EXISTS(SELECT 1 FROM public.bb_receipt_inventory_legacy_claims c WHERE c.scope_kind=p_scope_kind AND c.scope_id=p_scope_id AND c.legacy_id=v_legacy_id)
   THEN RAISE EXCEPTION 'receipt_legacy_credit_conflict'; END IF;
   claim_values:=claim_values||jsonb_build_object(v_legacy_id,jsonb_build_object('canonicalKey',food_key,'unit',unit_name,
    'quantity',coalesce((claim_values->v_legacy_id->>'quantity')::numeric,0)+credited_value));
  END IF;
  current_value:=coalesce((stock_value->>stock_key)::numeric,0)+quantity_value-credited_value;
  IF current_value>1000000 THEN RAISE EXCEPTION 'receipt_inventory_limit'; END IF;
  stock_value:=stock_value||jsonb_build_object(stock_key,current_value);
  locations_value:=locations_value||jsonb_build_object(stock_key,line->>'location');
  credits:=credits||jsonb_build_array(jsonb_build_object('lineId',line_id,'purchasedQuantity',quantity_value,'priorCreditedQuantity',credited_value,'addedQuantity',quantity_value-credited_value));
  food_subtotal:=food_subtotal+amount_value;
 END LOOP;
 IF food_subtotal+essential_subtotal>100000 OR NOT public.bb_receipt_inventory_valid_stock(stock_value) THEN RAISE EXCEPTION 'receipt_inventory_limit'; END IF;
 FOR adj IN SELECT value FROM jsonb_array_elements(p_payload->'adjustments') LOOP
  line_id:=adj->>'lineId';kind_value:=adj->>'kind';
  IF jsonb_typeof(adj) IS DISTINCT FROM 'object' OR NOT public.bb_receipt_inventory_valid_text(line_id,100,false) OR line_id=ANY(ids) OR
     jsonb_typeof(adj->'lineId') IS DISTINCT FROM 'string' OR jsonb_typeof(adj->'description') IS DISTINCT FROM 'string' OR
     NOT public.bb_receipt_inventory_valid_text(adj->>'description',200,false) OR jsonb_typeof(adj->'kind') IS DISTINCT FROM 'string' OR kind_value NOT IN ('discount','refund','tax') OR
     jsonb_typeof(adj->'amount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(adj) k WHERE k NOT IN ('lineId','kind','amount','description')) THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  ids:=array_append(ids,line_id);amount_value:=(adj->>'amount')::numeric;
  IF abs(amount_value)>100000 OR round(amount_value,2)<>amount_value OR (kind_value='tax' AND amount_value<0) OR
     (kind_value IN ('discount','refund') AND amount_value>0) THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF kind_value='tax' THEN tax_total:=tax_total+amount_value; ELSE adjustment_total:=adjustment_total+amount_value; END IF;
 END LOOP;
 IF abs(adjustment_total)>100000 OR tax_total>100000 THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
 IF jsonb_typeof(p_payload->'priceObservations') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'priceObservations')>200 THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
 FOR observation IN SELECT value FROM jsonb_array_elements(p_payload->'priceObservations') LOOP
  IF jsonb_typeof(observation) IS DISTINCT FROM 'object' OR observation->>'scopeId' IS DISTINCT FROM p_scope_id::text OR
     observation->>'market' IS DISTINCT FROM p_payload->>'market' OR observation->>'currency' IS DISTINCT FROM p_payload->>'currency' OR
     observation->>'retailer' IS DISTINCT FROM lower(p_payload->>'retailer') OR
     observation->>'receiptId' IS DISTINCT FROM p_receipt_id OR observation->>'priceType' NOT IN ('regular','promotion','unknown') OR
     jsonb_typeof(observation->'packPrice') IS DISTINCT FROM 'number' OR jsonb_typeof(observation->'packQuantity') IS DISTINCT FROM 'number' OR
     jsonb_typeof(observation->'packCount') IS DISTINCT FROM 'number' OR observation->>'source' IS DISTINCT FROM 'reviewed_receipt'
  THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(observation) k WHERE k NOT IN
   ('scopeId','market','retailer','currency','receiptId','canonicalKey','brand','packQuantity','packUnit','packCount','packPrice','priceType','eligibleForRegularPrice','source'))
  THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF (observation->>'packPrice')::numeric<=0 OR (observation->>'packPrice')::numeric>100000 OR
     (observation->>'packQuantity')::numeric<=0 OR
     NOT public.bb_receipt_inventory_valid_purchase(jsonb_build_object((observation->>'canonicalKey')||'|'||(observation->>'packUnit'),(observation->>'packQuantity')::numeric)) OR
     (observation->>'packCount')::numeric NOT BETWEEN 1 AND 10000 OR trunc((observation->>'packCount')::numeric)<>(observation->>'packCount')::numeric OR
     observation->'eligibleForRegularPrice' IS DISTINCT FROM to_jsonb((observation->>'priceType')='regular')
  THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'lines') l WHERE l.value->>'kind'='food' AND
   l.value->>'canonicalKey' IS NOT DISTINCT FROM observation->>'canonicalKey' AND l.value->'brand' IS NOT DISTINCT FROM observation->'brand' AND
   l.value->'packQuantity' IS NOT DISTINCT FROM observation->'packQuantity' AND l.value->'packUnit' IS NOT DISTINCT FROM observation->'packUnit' AND
   l.value->'packCount' IS NOT DISTINCT FROM observation->'packCount' AND l.value->'priceType' IS NOT DISTINCT FROM observation->'priceType' AND
   round((l.value->>'pricePaid')::numeric/(observation->>'packCount')::numeric,2)=(observation->>'packPrice')::numeric)
  THEN RAISE EXCEPTION 'receipt_invalid_payload'; END IF;
  normalized_observations:=normalized_observations||jsonb_build_array(observation);
 END LOOP;
 spending:=jsonb_build_object('foodSubtotal',food_subtotal,'essentialsSubtotal',essential_subtotal,
  'itemSubtotal',food_subtotal+essential_subtotal,'adjustmentsTotal',adjustment_total,'taxLines',tax_total,
  'knownItemSpend',food_subtotal+essential_subtotal+adjustment_total,'receiptTotal',receipt_total,'finalSpend',receipt_total,
  'reconciliationDifference',CASE WHEN receipt_total IS NULL THEN NULL ELSE receipt_total-food_subtotal-essential_subtotal-adjustment_total END);
 -- Keep the immutable reviewed receipt and server-derived observations, never
 -- the synchronization baseline (which is not receipt history or price data).
 saved_payload:=(p_payload-'inventoryBaseline'-'expectedScope'-'requestId')||jsonb_build_object('priceObservations',normalized_observations);
 UPDATE public.bb_receipt_inventory_scopes SET initialized=true,inventory_revision=next_revision,stock=stock_value,locations=locations_value,
  pantry_review_required=NOT (p_payload ? 'addToPantry'),pantry_shop_session_id=session_id,
  pantry_confirmed_at=CASE WHEN p_payload ? 'addToPantry' THEN now() ELSE NULL END,updated_at=now()
  WHERE scope_kind=p_scope_kind AND scope_id=p_scope_id;
 INSERT INTO public.bb_receipt_inventory_receipts(scope_kind,scope_id,receipt_id,request_id,payload_hash,semantic_payload,payload,credits,spending,receipt_revision,created_by)
 VALUES(p_scope_kind,p_scope_id,p_receipt_id,p_request_id,p_payload_hash,semantic,saved_payload,credits,spending,next_revision,p_actor);
 INSERT INTO public.bb_receipt_inventory_requests(scope_kind,scope_id,request_id,receipt_id,payload_hash)
 VALUES(p_scope_kind,p_scope_id,p_request_id,p_receipt_id,p_payload_hash);
 FOR e IN SELECT key,value FROM jsonb_each(claim_values) LOOP
  INSERT INTO public.bb_receipt_inventory_legacy_claims(scope_kind,scope_id,legacy_id,receipt_id,canonical_key,unit,credited_quantity)
  VALUES(p_scope_kind,p_scope_id,e.key,p_receipt_id,e.value->>'canonicalKey',e.value->>'unit',(e.value->>'quantity')::numeric);
 END LOOP;
 RETURN public.bb_receipt_inventory_snapshot(p_scope_kind,p_scope_id,p_receipt_id)||jsonb_build_object('duplicate',false);
EXCEPTION WHEN OTHERS THEN
 -- PL/pgSQL rolls this entire function block back before the handler runs,
 -- including a newly seeded scope, revision, receipt, price and legacy claims.
 error_value:=SQLERRM;
 IF error_value IN ('receipt_scope_conflict','receipt_revision_conflict','receipt_initialization_conflict','receipt_identity_conflict','receipt_legacy_credit_conflict') THEN
  RETURN jsonb_build_object('ok',false,'error',error_value,'conflict',true);
 ELSIF error_value='receipt_scope_forbidden' THEN RETURN jsonb_build_object('ok',false,'error',error_value,'forbidden',true);
 ELSIF error_value IN ('receipt_invalid_request','receipt_invalid_payload','receipt_inventory_limit') THEN
  RETURN jsonb_build_object('ok',false,'error',error_value,'invalid',true);
 ELSE RETURN jsonb_build_object('ok',false,'error','receipt_inventory_unavailable','retryable',true);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.bb_receipt_inventory_service(uuid,text,uuid,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_receipt_inventory_service(uuid,text,uuid,text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.bb_receipt_inventory_is_household(text),public.bb_receipt_inventory_valid_stock(jsonb),public.bb_receipt_inventory_valid_text(text,integer,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.bb_receipt_inventory_valid_purchase(jsonb) TO service_role;
COMMIT;
