-- Read-only synthetic fixture using the exact canonical SELECT from this migration.
-- No production records are inserted, updated, or deleted.
WITH fixture_profiles AS (SELECT * FROM jsonb_to_recordset('[{"user_id":"00000000-0000-4000-8000-000000000001","full_name":"Display Alias","phone":"09123456789","town_origin":"Banaue","barangay_origin":"Poblacion"},{"user_id":"00000000-0000-4000-8000-000000000002","full_name":"Pending Alias"},{"user_id":"00000000-0000-4000-8000-000000000003","full_name":"No Verification"},{"user_id":"00000000-0000-4000-8000-000000000004","full_name":"Legacy Alias"},{"user_id":"00000000-0000-4000-8000-000000000005","full_name":"  CaSE   Match  "},{"user_id":"00000000-0000-4000-8000-000000000006","full_name":"Declined Alias"},{"user_id":"00000000-0000-4000-8000-000000000007","full_name":"Missing Name"}]'::jsonb) AS f(user_id uuid, full_name text, phone text, town_origin text, barangay_origin text)),
fixture_requests AS (SELECT * FROM jsonb_to_recordset('[{"passenger_id":"00000000-0000-4000-8000-000000000001","full_name":"Approved Person","status":"approved","reviewed_at":"2026-08-02T00:00:00Z"},{"passenger_id":"00000000-0000-4000-8000-000000000002","full_name":"Pending Person","status":"submitted"},{"passenger_id":"00000000-0000-4000-8000-000000000005","full_name":"case match","status":"approved"},{"passenger_id":"00000000-0000-4000-8000-000000000006","full_name":"Declined Person","status":"rejected"},{"passenger_id":"00000000-0000-4000-8000-000000000007","full_name":"","status":"approved"}]'::jsonb) AS f(passenger_id uuid, full_name text, status text, town text, reviewed_at timestamptz, submitted_at timestamptz, id_front_path text, id_back_path text, selfie_with_id_path text)),
fixture_verifications AS (SELECT * FROM jsonb_to_recordset('[{"user_id":"00000000-0000-4000-8000-000000000001","id":1,"full_name":"Stale Legacy Name","status":"approved_admin","admin_reviewed_at":"2026-08-01T00:00:00Z"},{"user_id":"00000000-0000-4000-8000-000000000002","id":2,"full_name":"Stale Legacy Name","status":"approved_admin","admin_reviewed_at":"2026-08-01T00:00:00Z"},{"user_id":"00000000-0000-4000-8000-000000000004","id":4,"full_name":"Legacy Person","status":"approved_admin","admin_reviewed_at":"2026-08-01T00:00:00Z"},{"user_id":"00000000-0000-4000-8000-000000000006","id":6,"full_name":"Stale Legacy Name","status":"approved_admin","admin_reviewed_at":"2026-08-01T00:00:00Z"},{"user_id":"00000000-0000-4000-8000-000000000007","id":7,"full_name":"Stale Legacy Name","status":"approved_admin","admin_reviewed_at":"2026-08-01T00:00:00Z"}]'::jsonb) AS f(user_id uuid, id bigint, full_name text, status text, admin_reviewed_at timestamptz, created_at timestamptz, town_origin text, barangay_origin text, id_type text, id_photo_url text, selfie_photo_url text)),
fixture_users AS (SELECT * FROM jsonb_to_recordset('[{"id":"00000000-0000-4000-8000-000000000001","created_at":"2026-07-01T00:00:00Z","raw_user_meta_data":{"full_name":"Untrusted Metadata","verified":true}},{"id":"00000000-0000-4000-8000-000000000002","created_at":"2026-07-01T00:00:00Z","raw_user_meta_data":{"full_name":"Untrusted Metadata","verified":true}},{"id":"00000000-0000-4000-8000-000000000003","created_at":"2026-07-01T00:00:00Z","raw_user_meta_data":{"full_name":"Untrusted Metadata","verified":true}},{"id":"00000000-0000-4000-8000-000000000004","created_at":"2026-07-01T00:00:00Z","raw_user_meta_data":{"full_name":"Untrusted Metadata","verified":true}},{"id":"00000000-0000-4000-8000-000000000005","created_at":"2026-07-01T00:00:00Z","raw_user_meta_data":{"full_name":"Untrusted Metadata","verified":true}},{"id":"00000000-0000-4000-8000-000000000006","created_at":"2026-07-01T00:00:00Z","raw_user_meta_data":{"full_name":"Untrusted Metadata","verified":true}},{"id":"00000000-0000-4000-8000-000000000007","created_at":"2026-07-01T00:00:00Z","raw_user_meta_data":{"full_name":"Untrusted Metadata","verified":true}}]'::jsonb) AS f(id uuid, phone text, created_at timestamptz, raw_user_meta_data jsonb)),
canonical AS (
WITH ids AS (
  SELECT user_id FROM fixture_profiles
  UNION SELECT passenger_id FROM fixture_requests
  UNION SELECT user_id FROM fixture_verifications
), identity AS (
  SELECT ids.user_id,
    COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(u.raw_user_meta_data->>'full_name'), '')) AS display_name,
    CASE WHEN r.passenger_id IS NOT NULL THEN
      CASE WHEN r.status = 'approved' THEN NULLIF(btrim(r.full_name), '') END
    ELSE CASE WHEN v.status = 'approved_admin' THEN NULLIF(btrim(v.full_name), '') END END AS verified_full_name,
    COALESCE(NULLIF(btrim(p.phone), ''), NULLIF(btrim(u.phone), ''), NULLIF(btrim(u.raw_user_meta_data->>'phone'), '')) AS phone,
    COALESCE(NULLIF(btrim(p.town_origin), ''), NULLIF(btrim(u.raw_user_meta_data->>'town_origin'), ''), NULLIF(btrim(r.town), ''), NULLIF(btrim(v.town_origin), '')) AS town,
    COALESCE(NULLIF(btrim(p.barangay_origin), ''), NULLIF(btrim(u.raw_user_meta_data->>'barangay_origin'), ''), NULLIF(btrim(v.barangay_origin), '')) AS barangay,
    u.created_at AS account_created_at,
    CASE WHEN r.passenger_id IS NOT NULL THEN r.status
      WHEN v.status = 'approved_admin' THEN 'approved'
      WHEN v.status = 'pre_approved_dispatcher' THEN 'pending_admin'
      WHEN v.status = 'pending' THEN 'submitted'
      ELSE COALESCE(v.status, 'not_submitted') END AS verification_status,
    CASE WHEN r.passenger_id IS NOT NULL THEN
      CASE WHEN r.status = 'approved' THEN r.reviewed_at END
    ELSE CASE WHEN v.status = 'approved_admin' THEN v.admin_reviewed_at END END AS verified_at,
    CASE WHEN r.passenger_id IS NOT NULL THEN r.submitted_at ELSE v.created_at END AS verification_submitted_at,
    CASE WHEN r.passenger_id IS NOT NULL THEN 'passenger_verification_requests'
      WHEN v.user_id IS NOT NULL THEN 'passenger_verifications'
      ELSE NULL END AS verification_source,
    CASE WHEN r.passenger_id IS NOT NULL THEN r.passenger_id::text ELSE v.id::text END AS verification_record_id,
    CASE WHEN r.passenger_id IS NULL THEN NULLIF(btrim(v.id_type), '') END AS id_type,
    CASE WHEN r.passenger_id IS NOT NULL THEN NULLIF(btrim(r.id_front_path), '') IS NOT NULL
      ELSE NULLIF(btrim(v.id_photo_url), '') IS NOT NULL END AS has_id_front,
    r.passenger_id IS NOT NULL AND NULLIF(btrim(r.id_back_path), '') IS NOT NULL AS has_id_back,
    CASE WHEN r.passenger_id IS NOT NULL THEN NULLIF(btrim(r.selfie_with_id_path), '') IS NOT NULL
      ELSE NULLIF(btrim(v.selfie_photo_url), '') IS NOT NULL END AS has_selfie,
    r.passenger_id IS NOT NULL AND v.user_id IS NOT NULL AND (
      v.status IS DISTINCT FROM CASE r.status WHEN 'approved' THEN 'approved_admin'
        WHEN 'submitted' THEN 'pending' WHEN 'pending_admin' THEN 'pre_approved_dispatcher' ELSE r.status END
      OR (r.status = 'approved' AND lower(btrim(r.full_name)) IS DISTINCT FROM lower(btrim(v.full_name)))
    ) AS verification_record_conflict
  FROM ids
  LEFT JOIN fixture_profiles p ON p.user_id = ids.user_id
  LEFT JOIN fixture_requests r ON r.passenger_id = ids.user_id
  LEFT JOIN fixture_verifications v ON v.user_id = ids.user_id
  LEFT JOIN fixture_users u ON u.id = ids.user_id
)
SELECT identity.*,
  CASE WHEN display_name IS NULL OR verified_full_name IS NULL THEN NULL
    ELSE lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g'))
      <> lower(regexp_replace(btrim(verified_full_name), '\s+', ' ', 'g')) END AS identity_name_mismatch
FROM identity
)
SELECT 'approved request name wins over mirrored legacy data' AS check_name, (verified_full_name = 'Approved Person' AND verification_record_conflict AND verification_source = 'passenger_verification_requests') AS passed FROM canonical WHERE user_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL
SELECT 'display and verification stay separate' AS check_name, (display_name = 'Display Alias' AND identity_name_mismatch) AS passed FROM canonical WHERE user_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL
SELECT 'approval date comes from the authoritative request' AS check_name, (verified_at = '2026-08-02T00:00:00Z'::timestamptz) AS passed FROM canonical WHERE user_id = '00000000-0000-4000-8000-000000000001'::uuid
UNION ALL
SELECT 'pending request suppresses stale approved legacy name' AS check_name, (verified_full_name IS NULL AND verification_status = 'submitted' AND identity_name_mismatch IS NULL) AS passed FROM canonical WHERE user_id = '00000000-0000-4000-8000-000000000002'::uuid
UNION ALL
SELECT 'editable metadata cannot approve an unverified account' AS check_name, (verified_full_name IS NULL AND verification_status = 'not_submitted') AS passed FROM canonical WHERE user_id = '00000000-0000-4000-8000-000000000003'::uuid
UNION ALL
SELECT 'account creation uses the authentication account timestamp' AS check_name, (account_created_at = '2026-07-01T00:00:00Z'::timestamptz) AS passed FROM canonical WHERE user_id = '00000000-0000-4000-8000-000000000003'::uuid
UNION ALL
SELECT 'legacy-only approvals remain available with source attribution' AS check_name, (verified_full_name = 'Legacy Person' AND verification_source = 'passenger_verifications') AS passed FROM canonical WHERE user_id = '00000000-0000-4000-8000-000000000004'::uuid
UNION ALL
SELECT 'case and whitespace differences do not flag a mismatch' AS check_name, (identity_name_mismatch = false) AS passed FROM canonical WHERE user_id = '00000000-0000-4000-8000-000000000005'::uuid
UNION ALL
SELECT 'declined request suppresses stale approval' AS check_name, (verified_full_name IS NULL AND verification_status = 'rejected' AND verified_at IS NULL) AS passed FROM canonical WHERE user_id = '00000000-0000-4000-8000-000000000006'::uuid
UNION ALL
SELECT 'blank approved request name is not replaced with display or legacy name' AS check_name, (verified_full_name IS NULL AND identity_name_mismatch IS NULL) AS passed FROM canonical WHERE user_id = '00000000-0000-4000-8000-000000000007'::uuid;
