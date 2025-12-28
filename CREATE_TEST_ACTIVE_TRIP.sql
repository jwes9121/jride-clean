-- CREATE_TEST_ACTIVE_TRIP.sql
-- Run this in Supabase SQL Editor.
-- Creates 1 ACTIVE booking row (status = 'assigned') with a generated booking_code.
-- Does NOT assume columns exist; builds insert dynamically.

DO \$\$
DECLARE
  t_schema text := 'public';
  t_name   text := 'bookings';

  v_code text := 'TEST-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || lpad((floor(random()*10000))::int::text, 4, '0');
  v_status text := 'assigned';

  cols text := '';
  vals text := '';

  r record;

  -- helper flags
  has_gen_random_uuid boolean := exists(select 1 from pg_proc where proname = 'gen_random_uuid');
  has_uuid_v4 boolean := exists(select 1 from pg_proc where proname = 'uuid_generate_v4');

  -- common best-effort values
  v_town text := 'Lagawe';
  v_pickup_label text := 'Lagawe Public Market';
  v_dropoff_label text := 'Lagawe Town Plaza';
  v_pickup_lat double precision := 16.8035;
  v_pickup_lng double precision := 121.1197;
  v_dropoff_lat double precision := 16.8019;
  v_dropoff_lng double precision := 121.1167;

  -- for NOT NULL driver_id if required (we try to pick any existing driver_id if column exists)
  v_any_driver text := null;

  ins_sql text;
BEGIN
  -- If bookings has driver_id and it's NOT NULL, try to borrow any existing non-null driver_id from bookings
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=t_schema AND table_name=t_name AND column_name='driver_id'
  ) THEN
    EXECUTE format('select driver_id::text from %I.%I where driver_id is not null limit 1', t_schema, t_name)
    INTO v_any_driver;
  END IF;

  FOR r IN
    SELECT
      column_name,
      is_nullable,
      column_default,
      data_type,
      udt_name,
      is_generated
    FROM information_schema.columns
    WHERE table_schema = t_schema
      AND table_name   = t_name
    ORDER BY ordinal_position
  LOOP
    -- skip generated always columns
    IF r.is_generated = 'ALWAYS' THEN
      CONTINUE;
    END IF;

    -- We only include a column if we can supply a value OR it has no strict requirement.
    -- If column has default, we generally omit it (let default handle).
    -- If NOT NULL and no default, we must supply something.

    -- decide value expression (as SQL literal/expression)
    DECLARE v_expr text := null;
    BEGIN
      -- booking_code
      IF r.column_name = 'booking_code' THEN
        v_expr := quote_literal(v_code);

      -- status
      ELSIF r.column_name = 'status' THEN
        v_expr := quote_literal(v_status);

      -- some common best-effort fields (only if they exist)
      ELSIF r.column_name = 'town' OR r.column_name = 'zone' THEN
        v_expr := quote_literal(v_town);

      ELSIF r.column_name = 'pickup_label' THEN
        v_expr := quote_literal(v_pickup_label);

      ELSIF r.column_name = 'dropoff_label' THEN
        v_expr := quote_literal(v_dropoff_label);

      ELSIF r.column_name = 'pickup_lat' THEN
        v_expr := (v_pickup_lat::text);

      ELSIF r.column_name = 'pickup_lng' THEN
        v_expr := (v_pickup_lng::text);

      ELSIF r.column_name = 'dropoff_lat' THEN
        v_expr := (v_dropoff_lat::text);

      ELSIF r.column_name = 'dropoff_lng' THEN
        v_expr := (v_dropoff_lng::text);

      ELSIF r.column_name = 'created_at' OR r.column_name = 'updated_at' THEN
        v_expr := 'now()';

      -- driver_id if required
      ELSIF r.column_name = 'driver_id' THEN
        IF v_any_driver IS NOT NULL THEN
          v_expr := quote_literal(v_any_driver);
        END IF;
      END IF;

      -- If we didn't set a value, determine if we must (NOT NULL w/o default)
      IF v_expr IS NULL THEN
        IF r.is_nullable = 'NO' AND r.column_default IS NULL THEN
          -- supply a dummy value based on type
          IF r.udt_name = 'uuid' THEN
            IF has_gen_random_uuid THEN
              v_expr := 'gen_random_uuid()';
            ELSIF has_uuid_v4 THEN
              v_expr := 'uuid_generate_v4()';
            ELSE
              -- last resort: hope the table has its own default; if not, insert will fail and youâ€™ll see the column name
              v_expr := 'null';
            END IF;

          ELSIF r.data_type LIKE '%timestamp%' THEN
            v_expr := 'now()';

          ELSIF r.data_type = 'boolean' THEN
            v_expr := 'false';

          ELSIF r.data_type IN ('integer','bigint','smallint','numeric','double precision','real') THEN
            v_expr := '0';

          ELSE
            -- text / varchar / json / etc.
            v_expr := quote_literal('test');
          END IF;
        ELSE
          -- nullable or has default: omit it by leaving v_expr NULL
          v_expr := null;
        END IF;
      END IF;

      -- If we have an expression, include the column
      IF v_expr IS NOT NULL THEN
        cols := cols || CASE WHEN cols = '' THEN '' ELSE ', ' END || format('%I', r.column_name);
        vals := vals || CASE WHEN vals = '' THEN '' ELSE ', ' END || v_expr;
      END IF;
    END;
  END LOOP;

  IF cols = '' OR vals = '' THEN
    RAISE EXCEPTION 'Could not build INSERT (no columns selected).';
  END IF;

  ins_sql := format('insert into %I.%I (%s) values (%s) returning booking_code', t_schema, t_name, cols, vals);

  -- Execute insert
  DECLARE out_code text;
  BEGIN
    EXECUTE ins_sql INTO out_code;
    RAISE NOTICE 'âœ… Created test active trip. booking_code=%', out_code;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'âŒ Insert failed. SQL=%', ins_sql;
    RAISE;
  END;
END
\$\$;
