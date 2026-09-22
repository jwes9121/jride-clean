BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.agrimarket_producer_cancel_reservation_v1(
 p_order_code text,p_producer_id uuid,p_reason_code text,p_affected_product_ids uuid[],
 p_expected_updated_at timestamptz,p_reason_note text DEFAULT null
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $function$
DECLARE o public.agrimarket_orders%rowtype; v_now timestamptz := clock_timestamp();
 v_label text; v_note text:=trim(coalesce(p_reason_note,'')); v_names text; v_items jsonb; v_previous jsonb;
BEGIN
 v_label := CASE p_reason_code
  WHEN 'sold_outside_jride' THEN 'Reserved cut no longer available - sold outside JRide'
  WHEN 'insufficient_quantity' THEN 'Not enough of the reserved cut available'
  WHEN 'cut_unavailable' THEN 'Reserved cut unavailable after butchering'
  WHEN 'quality_issue' THEN 'Reserved cut did not meet quality requirements'
  WHEN 'other' THEN 'Farmer cannot supply the reserved cut' END;
 IF v_label IS NULL OR length(v_note)>500 OR (p_reason_code='other' AND length(v_note)<5)
  OR p_expected_updated_at IS NULL OR NOT isfinite(p_expected_updated_at)
  OR coalesce(cardinality(p_affected_product_ids),0) NOT BETWEEN 1 AND 50
  OR EXISTS(SELECT 1 FROM unnest(p_affected_product_ids) x WHERE x IS NULL)
  OR (SELECT count(DISTINCT x) FROM unnest(p_affected_product_ids) x)<>cardinality(p_affected_product_ids) THEN
  RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_CANCELLATION_DETAILS_REQUIRED'); END IF;
 SELECT * INTO o FROM public.agrimarket_orders WHERE order_code=trim(p_order_code) AND producer_id=p_producer_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); END IF;
 v_now := clock_timestamp();
 IF NOT EXISTS(SELECT 1 FROM public.agrimarket_producers WHERE id=p_producer_id AND status='active') THEN
  RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_PRODUCER_NOT_ACTIVE'); END IF;
 -- A duplicate request can read the original result, never release stock twice.
 IF o.status='cancelled' THEN
  SELECT details INTO v_previous FROM public.agrimarket_order_events WHERE order_id=o.id
   AND actor_type='producer' AND actor_id=p_producer_id AND reason_code='producer_reservation_cancelled'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'already_done',true,'order_code',o.order_code,'status','cancelled','cancel_reason',o.cancel_reason,'details',v_previous); END IF;
 END IF;
 IF o.fulfillment_mode<>'scheduled_harvest' OR NOT EXISTS(SELECT 1 FROM public.agrimarket_order_items WHERE order_id=o.id)
  OR EXISTS(SELECT 1 FROM public.agrimarket_order_items WHERE order_id=o.id AND product_group IS DISTINCT FROM 'meat') THEN
  RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_BUTCHERING_RESERVATION_REQUIRED'); END IF;
 IF o.status NOT IN ('awaiting_producer','awaiting_harvest') OR o.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_CHANGED','message','The reservation changed. Refresh and review it again before cancelling.'); END IF;
 IF o.assigned_driver_id IS NOT NULL OR o.picked_up_at IS NOT NULL OR o.delivering_at IS NOT NULL OR o.delivered_at IS NOT NULL
  OR o.customer_cash_collected_at IS NOT NULL OR coalesce(o.customer_cash_collected_amount,0)>0
  OR o.producer_paid_at IS NOT NULL OR coalesce(o.producer_paid_amount,0)>0
  OR o.final_cash_collected_at IS NOT NULL OR coalesce(o.final_cash_collected_amount,0)>0
  OR o.pickup_issue->>'status'='open'
  OR EXISTS(SELECT 1 FROM public.agrimarket_driver_offers WHERE order_id=o.id AND status IN ('offered','accepted')) THEN
  RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_RECOVERY_REQUIRED','message','A driver, cash or goods are involved. Contact JRide; this reservation cannot be cancelled here.'); END IF;
 IF o.status='awaiting_producer' AND o.producer_confirm_expires_at<=v_now THEN
  RETURN public.agrimarket_producer_decide_order_v4(o.order_code,p_producer_id,'reject',null,null,v_now);
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_affected_product_ids) x WHERE NOT EXISTS(
   SELECT 1 FROM public.agrimarket_order_items WHERE order_id=o.id AND product_id=x)) THEN
  RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_UNAVAILABLE_CUT_NOT_IN_ORDER'); END IF;
 -- Stable lock order protects reservations and concurrent stock edits/checkout.
 PERFORM p.id FROM public.agrimarket_products p JOIN public.agrimarket_order_items i ON i.product_id=p.id
  WHERE i.order_id=o.id ORDER BY p.id FOR UPDATE OF p;
 IF EXISTS(SELECT 1 FROM public.agrimarket_inventory_reservations r JOIN public.agrimarket_products p ON p.id=r.product_id
  WHERE r.order_id=o.id AND r.status='active' GROUP BY p.id,p.reserved_quantity HAVING sum(r.quantity)>p.reserved_quantity) THEN
  RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_STOCK_RECONCILIATION_REQUIRED'); END IF;
 SELECT string_agg(product_name,', ' ORDER BY product_name),jsonb_agg(jsonb_build_object('product_id',product_id,'name',product_name,'quantity',quantity,'unit',selling_unit) ORDER BY product_name)
 INTO v_names,v_items FROM public.agrimarket_order_items WHERE order_id=o.id AND product_id=ANY(p_affected_product_ids);
 -- Pause only the selected unavailable cuts; releasing this hold must not relist them.
 UPDATE public.agrimarket_products SET is_active=false,updated_at=v_now WHERE producer_id=p_producer_id AND id=ANY(p_affected_product_ids);
 PERFORM public.agrimarket_release_active_reservations_v1(o.id,'released','Producer cancelled reservation: '||p_reason_code,v_now);
 UPDATE public.agrimarket_harvest_proposals SET status='cancelled',updated_at=v_now WHERE order_id=o.id AND status='pending_customer';
 UPDATE public.agrimarket_orders SET status='cancelled',cancelled_at=v_now,updated_at=v_now,
  producer_responded_at=coalesce(producer_responded_at,v_now),
  cancel_reason=v_label||'. Affected cuts: '||v_names||CASE WHEN v_note<>'' THEN '. '||v_note ELSE '' END
 WHERE id=o.id;
 INSERT INTO public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
 VALUES(o.id,o.status,'cancelled','producer',p_producer_id,'producer_reservation_cancelled',
  jsonb_build_object('reason_code',p_reason_code,'reason_label',v_label,'note',nullif(v_note,''),
   'affected_items',v_items,'paused_product_ids',to_jsonb(p_affected_product_ids),'cancellation_scope','entire_reservation',
   'other_reservations_changed',false,'original_total_payable',o.total_payable),v_now);
 RETURN jsonb_build_object('ok',true,'order_code',o.order_code,'status','cancelled','cancellation_scope','entire_reservation','paused_product_ids',to_jsonb(p_affected_product_ids));
END; $function$;
REVOKE ALL ON FUNCTION public.agrimarket_producer_cancel_reservation_v1(text,uuid,text,uuid[],timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_producer_cancel_reservation_v1(text,uuid,text,uuid[],timestamptz,text) TO service_role;
COMMIT;
