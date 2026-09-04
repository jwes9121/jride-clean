create or replace function public.errand_driver_complete_handoff_v1(
  p_booking_id uuid,
  p_driver_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking public.bookings%rowtype;
  v_job public.errand_jobs%rowtype;
  v_job_wait integer := 0;
  v_wait_minutes integer := 0;
  v_after public.bookings%rowtype;
  v_purchase_total numeric := 0;
  v_funds numeric := 0;
  v_change_due numeric := 0;
  v_change_returned numeric := 0;
  v_change_remaining numeric := 0;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'BOOKING_NOT_FOUND');
  end if;
  if lower(coalesce(v_booking.service_type, '')) <> 'errand' then
    return jsonb_build_object('ok', false, 'error', 'NOT_ERRAND_BOOKING');
  end if;
  if coalesce(v_booking.assigned_driver_id, v_booking.driver_id) is distinct from p_driver_id then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_ASSIGNED');
  end if;
  if v_booking.status <> 'on_trip' then
    return jsonb_build_object(
      'ok', false,
      'error', 'ERRAND_HANDOFF_STATUS_INVALID',
      'status', v_booking.status
    );
  end if;

  select * into v_job
  from public.errand_jobs
  where booking_id = p_booking_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ERRAND_JOB_NOT_FOUND');
  end if;

  if v_job.handoff_completed_at is not null then
    return jsonb_build_object(
      'ok', true,
      'already_completed', true,
      'booking_id', p_booking_id,
      'errand_stage', v_job.errand_stage
    );
  end if;
  if v_job.unreachable_escalated_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ERRAND_HANDOFF_ALREADY_ESCALATED');
  end if;

  if v_job.errand_stage <> 'final_recipient_met'
     or v_job.final_recipient_met_at is null
     or v_job.waiting_started_at is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'FINAL_RECIPIENT_MET_REQUIRED',
      'errand_stage', v_job.errand_stage
    );
  end if;

  if v_job.is_pabili then
    select coalesce(sum(greatest(coalesce(s.purchase_total, 0), 0)), 0)
    into v_purchase_total
    from public.errand_stops s
    where s.booking_id = p_booking_id;

    v_funds := greatest(coalesce(v_job.pabili_cash_received, 0), 0);
    if v_purchase_total > v_funds + 0.009 then
      return jsonb_build_object(
        'ok', false,
        'error', 'PABILI_FUNDS_SHORTFALL',
        'customer_funds_received', v_funds,
        'purchase_total', v_purchase_total,
        'shortfall', round(v_purchase_total - v_funds, 2)
      );
    end if;

    v_change_due := greatest(v_funds - v_purchase_total, 0);
    v_change_returned := greatest(coalesce(v_job.pabili_change_returned, 0), 0);
    v_change_remaining := greatest(v_change_due - v_change_returned, 0);

    update public.errand_jobs
    set pabili_purchase_total = v_purchase_total,
        pabili_change_due = v_change_due,
        pabili_change_returned = v_change_due,
        pabili_change_returned_at = case
          when v_change_due > 0 then coalesce(pabili_change_returned_at, now())
          else pabili_change_returned_at
        end,
        updated_at = now()
    where booking_id = p_booking_id;

    if v_change_remaining > 0.009 then
      insert into public.errand_pabili_fund_events (
        booking_id,
        event_type,
        amount,
        confirmation_method,
        note
      ) values (
        p_booking_id,
        'change_returned',
        v_change_remaining,
        'driver_complete_handoff',
        'Remaining customer change handed over with item and physical receipt after Recipient Met'
      );
    end if;

    v_change_returned := v_change_due;
  end if;

  v_job_wait := greatest(coalesce(v_job.waiting_accumulated_seconds, 0), 0);
  v_wait_minutes := case
    when v_job_wait <= 0 then 0
    else ceil(v_job_wait::numeric / 60)::integer
  end;

  update public.errand_jobs
  set waiting_accumulated_seconds = v_job_wait,
      waiting_started_at = null,
      handoff_completed_at = now(),
      errand_stage = 'handoff_complete',
      updated_at = now()
  where booking_id = p_booking_id;

  update public.bookings
  set waiting_minutes = v_wait_minutes,
      updated_at = now()
  where id = p_booking_id;

  select * into v_after
  from public.bookings
  where id = p_booking_id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'status', v_after.status,
    'errand_stage', 'handoff_complete',
    'final_recipient_met_at', v_job.final_recipient_met_at,
    'waiting_accumulated_seconds', v_job_wait,
    'waiting_minutes', v_after.waiting_minutes,
    'waiting_fee', v_after.waiting_fee,
    'pabili_purchase_total', case when v_job.is_pabili then v_purchase_total else null end,
    'pabili_change_due', case when v_job.is_pabili then v_change_due else null end,
    'pabili_change_returned', case when v_job.is_pabili then v_change_returned else null end,
    'change_recorded_at_handoff', case when v_job.is_pabili then true else false end,
    'total_errand_fare', v_after.total_errand_fare
  );
end;
$function$;

revoke all on function public.errand_driver_complete_handoff_v1(uuid, uuid) from public;
revoke all on function public.errand_driver_complete_handoff_v1(uuid, uuid) from anon;
revoke all on function public.errand_driver_complete_handoff_v1(uuid, uuid) from authenticated;
grant execute on function public.errand_driver_complete_handoff_v1(uuid, uuid) to service_role;

create or replace function public.errand_driver_record_change_returned_v1(
  p_booking_id uuid,
  p_driver_id uuid,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking public.bookings%rowtype;
  v_job public.errand_jobs%rowtype;
  v_purchase_total numeric := 0;
  v_funds numeric := 0;
  v_change_due numeric := 0;
  v_remaining numeric := 0;
begin
  if p_amount is null or p_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'CHANGE_RETURNED_AMOUNT_REQUIRED');
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'error', 'BOOKING_NOT_FOUND'); end if;
  if lower(coalesce(v_booking.service_type, '')) <> 'errand' then return jsonb_build_object('ok', false, 'error', 'NOT_ERRAND_BOOKING'); end if;
  if coalesce(v_booking.assigned_driver_id, v_booking.driver_id) is distinct from p_driver_id then return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_ASSIGNED'); end if;
  if v_booking.status <> 'on_trip' then return jsonb_build_object('ok', false, 'error', 'ERRAND_CHANGE_RETURN_STATUS_INVALID', 'status', v_booking.status); end if;

  select * into v_job
  from public.errand_jobs
  where booking_id = p_booking_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'error', 'ERRAND_JOB_NOT_FOUND'); end if;
  if not v_job.is_pabili then return jsonb_build_object('ok', false, 'error', 'NOT_PABILI_ERRAND'); end if;
  if v_job.errand_stage <> 'final_recipient_met'
     or v_job.final_recipient_met_at is null
     or v_job.waiting_started_at is not null then
    return jsonb_build_object('ok', false, 'error', 'FINAL_RECIPIENT_MET_REQUIRED');
  end if;

  select coalesce(sum(greatest(coalesce(s.purchase_total, 0), 0)), 0)
  into v_purchase_total
  from public.errand_stops s
  where s.booking_id = p_booking_id;

  v_funds := greatest(coalesce(v_job.pabili_cash_received, 0), 0);
  if v_purchase_total > v_funds + 0.009 then
    return jsonb_build_object(
      'ok', false,
      'error', 'PABILI_FUNDS_SHORTFALL',
      'customer_funds_received', v_funds,
      'purchase_total', v_purchase_total,
      'shortfall', round(v_purchase_total - v_funds, 2)
    );
  end if;

  v_change_due := greatest(v_funds - v_purchase_total, 0);
  v_remaining := greatest(v_change_due - greatest(coalesce(v_job.pabili_change_returned, 0), 0), 0);

  if abs(p_amount - v_remaining) > 0.009 then
    return jsonb_build_object(
      'ok', false,
      'error', 'CHANGE_RETURNED_AMOUNT_MISMATCH',
      'change_remaining', round(v_remaining, 2),
      'submitted_amount', p_amount
    );
  end if;

  update public.errand_jobs
  set pabili_purchase_total = v_purchase_total,
      pabili_change_due = v_change_due,
      pabili_change_returned = greatest(coalesce(pabili_change_returned, 0), 0) + p_amount,
      pabili_change_returned_at = case when v_remaining <= p_amount + 0.009 then now() else pabili_change_returned_at end,
      updated_at = now()
  where booking_id = p_booking_id;

  if p_amount > 0 then
    insert into public.errand_pabili_fund_events (
      booking_id, event_type, amount, confirmation_method, note
    ) values (
      p_booking_id,
      'change_returned',
      p_amount,
      'in_person',
      'Customer change returned after Recipient Met'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'purchase_total', round(v_purchase_total, 2),
    'customer_funds_received', round(v_funds, 2),
    'change_due', round(v_change_due, 2),
    'change_returned_now', round(p_amount, 2),
    'change_remaining', 0,
    'waiting_continues', false
  );
end;
$function$;

revoke all on function public.errand_driver_record_change_returned_v1(uuid, uuid, numeric) from public;
revoke all on function public.errand_driver_record_change_returned_v1(uuid, uuid, numeric) from anon;
revoke all on function public.errand_driver_record_change_returned_v1(uuid, uuid, numeric) from authenticated;
grant execute on function public.errand_driver_record_change_returned_v1(uuid, uuid, numeric) to service_role;
