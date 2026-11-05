-- Read-only receipt metadata upgrade. Stored purchases and stock stay intact.
-- Patch the live snapshot body narrowly so unrelated function upgrades survive.
BEGIN;
DO $migration$
DECLARE
 definition text;
 needle text := $needle$'shopSessionId',t.payload->'shopSessionId','name',l.value->'name','brand',l.value->'brand',$needle$;
 replacement text := $replacement$'shopSessionId',t.payload->'shopSessionId','name',l.value->'name','brand',l.value->'brand',
    'productName',l.value->'name','kind','essential','priceType',l.value->'priceType',
    'eligibleForRegularPrice',coalesce((l.value->>'priceType')='regular',false),$replacement$;
BEGIN
 SELECT pg_catalog.pg_get_functiondef(p.oid) INTO definition
 FROM pg_catalog.pg_proc p
 WHERE p.oid=to_regprocedure('public.bb_receipt_inventory_snapshot(text,uuid,text)');
 IF definition IS NULL THEN
  RAISE EXCEPTION 'Apply the receipt inventory migrations first';
 END IF;
 IF strpos(definition,replacement)>0 THEN RETURN; END IF;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
  RAISE EXCEPTION 'Receipt snapshot changed; review the household price projection before applying';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END
$migration$;
REVOKE ALL ON FUNCTION public.bb_receipt_inventory_snapshot(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_receipt_inventory_snapshot(text,uuid,text) TO service_role;
COMMIT;
