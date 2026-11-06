# Personal cloud backup setup

The account screen reads and upserts `public.basketboss_data` in the production **basketboss-auth** project, reference **kbhyosxuvlcazyzzinqv**. A read-only schema inspection on 6 November 2026 found the table absent and no equivalent personal-backup table among the nine public tables. The client’s table name matches its established backup contract; the missing table is the cause of the reported schema-cache error.

The reviewed migration is [20261106120712_basketboss_data_cloud_backup.sql](../supabase/migrations/20261106120712_basketboss_data_cloud_backup.sql). It has been exercised in isolated PostgreSQL, not applied to production as part of the client release.

## Apply the reviewed SQL

1. Open the Supabase Dashboard and select **basketboss-auth**, confirming project reference **kbhyosxuvlcazyzzinqv** in the URL. Review or take the usual project backup before a schema change.
2. Open **SQL Editor**, paste the complete migration above, and run it as the database owner. It creates one personal-backup table, three owner-only policies, explicit grants and a schema-cache reload notification. It does not create accounts or modify existing household, receipt, subscription or payment data.
3. If the migration reports `basketboss_data_preflight_shape` or `basketboss_data_preflight_policy`, stop and inspect the existing object or policies. Do not remove the guard or drop existing data to force the migration through. A rerun of the migration’s own expected schema preserves existing backups.
4. Run the read-only verification queries below. Then sign in with a dedicated test account and choose **Upload this device’s plan**. On a second device using that same account, choose **Restore cloud plan** and confirm the intended copy. Check that a different account cannot read or overwrite that backup.

The client keeps local data and sign-in available while cloud setup is missing. It pauses repeated automatic requests and offers an explicit Upload or Restore retry after setup is corrected. A failed request is never treated as an empty remote account. Existing differing local and cloud copies still require the user’s normal restore/upload choice.

## Verify the installed schema without reading customer backups

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='basketboss_data'
ORDER BY ordinal_position;

SELECT relrowsecurity
FROM pg_class
WHERE oid=to_regclass('public.basketboss_data');

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid=to_regclass('public.basketboss_data')
ORDER BY conname;

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename='basketboss_data'
ORDER BY policyname;

SELECT
  has_table_privilege('anon','public.basketboss_data','SELECT') AS anonymous_read,
  has_table_privilege('authenticated','public.basketboss_data','SELECT,INSERT,UPDATE') AS authenticated_backup,
  has_table_privilege('authenticated','public.basketboss_data','DELETE') AS browser_delete;
```

Expected columns are `user_id uuid` (primary key and cascading reference to `auth.users.id`), `data jsonb` (non-null object), and `updated_at timestamptz` (non-null timestamp). RLS must be enabled. Only the matching `auth.uid()` can select, insert or update a row. An update checks both its existing owner and new owner. Expected privilege results are `false`, `true`, `false` respectively. The primary key supports the client’s `on_conflict=user_id` upsert and prevents duplicate rows per account.

The privileged server role has the CRUD access needed for account-data cleanup; browser clients have no delete grant. Deleting an Auth user cascades its backup, and the foreign key prevents an old token from recreating the deleted user’s row.

This JSON is a user-owned plan and Kitchen snapshot. It is **not a Premium entitlement source**: no membership is granted by writing a field into a backup. No private server key belongs in the app or this SQL file.
