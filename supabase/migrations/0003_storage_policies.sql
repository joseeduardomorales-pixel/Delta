-- ============================================================================
-- Delta — Storage RLS policies for the `action-photos` bucket
-- ----------------------------------------------------------------------------
-- Bucket itself is created out-of-band via the Supabase Storage API in the
-- bootstrap script (db/seed/bootstrap_admin.mjs). This file installs the
-- access policies on storage.objects.
--
-- Object key convention (enforced via policy):
--   work-orders/{work_order_id}/{uuid}.{ext}
--
-- The first path segment after the bucket is "work-orders"; the second is
-- the owning work_order id. We use that to gate reads/writes via the same
-- ownership rules as public.action_photos.
-- ============================================================================

-- READ: any authenticated user can read photos (the kardex is a shared view).
DROP POLICY IF EXISTS action_photos_read ON storage.objects;
CREATE POLICY action_photos_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'action-photos');

-- INSERT: owner must own the parent work_order, or be admin.
DROP POLICY IF EXISTS action_photos_insert ON storage.objects;
CREATE POLICY action_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'action-photos'
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.work_orders wo
        WHERE wo.user_id = auth.uid()
          -- The owning work_order id is the second path segment.
          AND wo.id::text = split_part(name, '/', 2)
      )
    )
  );

-- DELETE / UPDATE: admin only. (Photos are evidence; techs can't remove them.)
DROP POLICY IF EXISTS action_photos_modify_admin ON storage.objects;
CREATE POLICY action_photos_modify_admin ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'action-photos' AND public.is_admin())
  WITH CHECK (bucket_id = 'action-photos' AND public.is_admin());
