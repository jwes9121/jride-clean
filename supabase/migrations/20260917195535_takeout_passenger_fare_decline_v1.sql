create or replace function public.decline_takeout_fare_proposal_v1(
  p_passenger_id uuid,
  p_expected_proposed_at timestamptz,
  p_expected_expires_at timestamptz,
  p_expected_total numeric,
  p_expected_driver_id uuid,
  p_booking_id uuid default null,
  p_booking_code text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_status_before text;
  v_effective_expires_at timestamptz;
  v_label text;
  v_message text;
begin
  if p_passenger_id is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  if p_booking_id is null and nullif(btrim(coalesce(p_booking_code, '')), '') is null then
    return jsonb_build_object('outcome', 'order_required');
  end if;

  if p_booking_id is not null then
    select *
      into v_booking
    from public.bookings
    where id = p_booking_id
    for update;
  else
    select *
      into v_booking
    from public.bookings
    where booking_code = btrim(p_booking_code)
    order by created_at desc
    limit 1
    for update;
  end if;

  if not found or v_booking.id is null or lower(coalesce(v_booking.service_type, '')) <> 'takeout' then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v_booking.created_by_user_id is distinct from p_passenger_id then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if v_booking.takeout_fee_proposed_at is distinct from p_expected_proposed_at
     or v_booking.takeout_fee_expires_at is distinct from p_expected_expires_at
     or v_booking.takeout_total_payable is distinct from p_expected_total
     or v_booking.takeout_fee_proposed_by_driver_id is distinct from p_expected_driver_id then
    return jsonb_build_object('outcome', 'proposal_changed');
  end if;

  if lower(coalesce(v_booking.status, '')) = 'cancelled'
     and lower(coalesce(v_booking.takeout_pricing_status, '')) = 'passenger_declined' then
    return jsonb_build_object(
      'outcome', 'already_declined',
      'booking_id', v_booking.id,
      'booking_code', v_booking.booking_code
    );
  end if;

  if v_booking.takeout_customer_confirmed_at is not null
     or lower(coalesce(v_booking.takeout_pricing_status, '')) = 'customer_confirmed' then
    return jsonb_build_object('outcome', 'already_confirmed');
  end if;

  if lower(coalesce(v_booking.status, '')) in ('cancelled', 'canceled', 'completed')
     or lower(coalesce(v_booking.vendor_status, '')) in ('cancelled', 'canceled', 'completed')
     or lower(coalesce(v_booking.customer_status, '')) in ('cancelled', 'canceled', 'completed') then
    return jsonb_build_object('outcome', 'inactive');
  end if;

  if lower(coalesce(v_booking.takeout_pricing_status, '')) <> 'driver_fee_proposed'
     or v_booking.takeout_delivery_fee is null
     or v_booking.assigned_driver_id is distinct from p_expected_driver_id then
    return jsonb_build_object('outcome', 'proposal_changed');
  end if;

  if v_booking.takeout_fee_proposed_at is null or v_booking.takeout_fee_expires_at is null then
    return jsonb_build_object('outcome', 'proposal_changed');
  end if;

  v_effective_expires_at := least(
    v_booking.takeout_fee_expires_at,
    v_booking.takeout_fee_proposed_at + interval '5 minutes'
  );

  if p_now >= v_effective_expires_at then
    return jsonb_build_object('outcome', 'proposal_expired');
  end if;

  v_status_before := v_booking.status;

  update public.bookings
  set
    status = 'cancelled',
    vendor_status = 'cancelled',
    customer_status = 'cancelled',
    driver_status = 'cancelled',
    takeout_pricing_status = 'passenger_declined',
    cancel_reason = 'Passenger declined the proposed delivery fare.',
    ride_reassignment_pending = false,
    driver_id = null,
    assigned_driver_id = null,
    assigned_at = null,
    driver_accept_expires_at = null,
    takeout_driver_accept_expires_at = null,
    last_expired_driver_id = p_expected_driver_id,
    updated_at = p_now
  where id = v_booking.id
    and service_type = 'takeout'
    and takeout_pricing_status = 'driver_fee_proposed'
    and takeout_customer_confirmed_at is null
    and assigned_driver_id = p_expected_driver_id
    and takeout_fee_proposed_by_driver_id = p_expected_driver_id
    and takeout_fee_proposed_at = p_expected_proposed_at
    and takeout_fee_expires_at = p_expected_expires_at
    and takeout_total_payable = p_expected_total
    and p_now < least(takeout_fee_expires_at, takeout_fee_proposed_at + interval '5 minutes')
  returning * into v_booking;

  if not found then
    return jsonb_build_object('outcome', 'proposal_changed');
  end if;

  v_label := case
    when nullif(btrim(coalesce(v_booking.booking_code, '')), '') is null then ''
    else ' ' || btrim(v_booking.booking_code)
  end;
  v_message := 'Takeout booking' || v_label ||
    ' was cancelled because the passenger declined the proposed delivery fare. You may accept another booking.';

  insert into public.driver_notifications(driver_id, type, message)
  values (p_expected_driver_id, 'fare_declined', v_message);

  perform public.record_booking_lifecycle_event(
    v_booking.id,
    v_booking.booking_code,
    p_passenger_id,
    p_expected_driver_id,
    null,
    'fare_response_declined',
    v_status_before,
    'cancelled',
    v_booking.town,
    'passenger_api',
    'passenger',
    p_passenger_id,
    jsonb_build_object(
      'reason', 'passenger_fare_declined',
      'expires_at', p_expected_expires_at,
      'response_owner', 'passenger',
      'driver_penalty', false,
      'reassign', false
    )
  );

  return jsonb_build_object(
    'outcome', 'declined',
    'booking_id', v_booking.id,
    'booking_code', v_booking.booking_code,
    'released_driver_id', p_expected_driver_id,
    'driver_penalty', false,
    'reassign', false
  );
end;
$$;

revoke all on function public.decline_takeout_fare_proposal_v1(uuid, timestamptz, timestamptz, numeric, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.decline_takeout_fare_proposal_v1(uuid, timestamptz, timestamptz, numeric, uuid, uuid, text, timestamptz) to service_role;
