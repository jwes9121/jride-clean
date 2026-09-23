BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Read-only snapshot: counts, category and page are calculated together.
-- No order status, inventory, dispatch, cancellation or timer is modified.
CREATE FUNCTION public.agrimarket_passenger_order_sections_v1(
  p_customer_user_id uuid, p_view text, p_page integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_customer_user_id IS NULL OR p_view IS NULL OR p_view NOT IN ('deliveries','reservations','history')
     OR p_page IS NULL OR p_page<0 OR p_page>999999 THEN
    RAISE EXCEPTION 'AGRIMARKET_ORDER_VIEW_INVALID';
  END IF;
  WITH owned AS MATERIALIZED (
    SELECT o.*,
      CASE WHEN o.status IN ('completed','cancelled','producer_rejected','producer_timeout') THEN 'history'
        WHEN o.fulfillment_mode='scheduled_harvest' AND o.status IN ('awaiting_producer','awaiting_harvest') THEN 'reservations'
        ELSE 'deliveries' END AS section,
      (o.status='awaiting_customer_reapproval' AND o.customer_reapproval_response IS NULL)
        OR (o.status='awaiting_harvest' AND EXISTS(SELECT 1 FROM public.agrimarket_harvest_proposals hp
              WHERE hp.order_id=o.id AND hp.status='pending_customer')) AS needs_response
    FROM public.agrimarket_orders o WHERE o.customer_user_id=p_customer_user_id
      AND o.status IN ('completed','cancelled','producer_rejected','producer_timeout',
        'awaiting_producer','awaiting_harvest','producer_accepted','preparing',
        'awaiting_customer_reapproval','ready_for_dispatch','dispatching','driver_assigned',
        'picked_up','delivering','delivered','exception')
  ), counts AS (
    SELECT count(*) FILTER(WHERE section='deliveries')::integer AS deliveries,
      count(*) FILTER(WHERE section='reservations')::integer AS reservations,
      count(*) FILTER(WHERE section='history')::integer AS history,
      count(*) FILTER(WHERE section<>'history' AND needs_response)::integer AS needs_response,
      count(*) FILTER(WHERE section=p_view)::integer AS total FROM owned
  ), page_info AS (
    SELECT *, least(p_page,greatest((total-1)/25,0)) AS page FROM counts
  ), ranked AS (
    SELECT o.*,row_number() OVER(ORDER BY
      CASE WHEN p_view='deliveries' THEN CASE
        WHEN needs_response THEN 0 WHEN status='exception' THEN 1
        WHEN assigned_driver_id IS NULL AND status IN ('ready_for_dispatch','dispatching') THEN 2
        WHEN status IN ('driver_assigned','picked_up','delivering') THEN 3 ELSE 4 END ELSE 0 END,
      CASE WHEN p_view='reservations' THEN harvest_expected_start_at END ASC NULLS LAST,
      CASE WHEN p_view='deliveries' AND assigned_driver_id IS NULL THEN ready_at END ASC NULLS LAST,
      created_at DESC,id DESC) AS rn FROM owned o WHERE section=p_view
  ), selected AS (
    SELECT r.* FROM ranked r CROSS JOIN page_info pi WHERE r.rn>pi.page*25 AND r.rn<=(pi.page+1)*25
  ), cards AS (
    SELECT o.rn,jsonb_build_object(
      'order_code',o.order_code,'status',o.status,'fulfillment_mode',o.fulfillment_mode,
      'harvest_expected_start_at',o.harvest_expected_start_at,'harvest_expected_end_at',o.harvest_expected_end_at,
      'producer_confirm_expires_at',o.producer_confirm_expires_at,'producer_accepted_at',o.producer_accepted_at,
      'ready_at',o.ready_at,'preferred_vehicle_type',o.preferred_vehicle_type,
      'has_assigned_driver',o.assigned_driver_id IS NOT NULL,'needs_customer_response',o.needs_response,
      'waiting_since',CASE WHEN o.assigned_driver_id IS NULL
        AND o.status IN ('preparing','ready_for_dispatch','dispatching') AND o.ready_at<=statement_timestamp() THEN o.ready_at ELSE NULL END,
      'total_payable',o.total_payable,'cancel_reason',o.cancel_reason,'cancelled_at',o.cancelled_at,
      'completed_at',o.completed_at,'created_at',o.created_at,'updated_at',o.updated_at,
      'store',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('name',p.vendor_name,'town',p.town) END,
      'items',coalesce((SELECT jsonb_agg(jsonb_build_object('product_id',i.product_id,'product_name',i.product_name,
        'product_group',i.product_group,'species',i.species,'meat_cut',i.meat_cut,'selling_unit',i.selling_unit,
        'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total,
        'availability_mode',i.availability_mode,'harvest_start_at',i.harvest_start_at,'harvest_end_at',i.harvest_end_at)
        ORDER BY i.created_at,i.id) FROM public.agrimarket_order_items i WHERE i.order_id=o.id),'[]'::jsonb)
    ) AS card FROM selected o LEFT JOIN public.agrimarket_producers p ON p.id=o.producer_id
  )
  SELECT jsonb_build_object('ok',true,'layout','sections_v1','view',p_view,'page',pi.page,'requested_page',p_page,
    'page_size',25,'total_count',pi.total,'has_more',(pi.page+1)*25<pi.total,
    'active_count',pi.deliveries+pi.reservations,
    'counts',jsonb_build_object('deliveries',pi.deliveries,'reservations',pi.reservations,'history',pi.history,'needs_response',pi.needs_response),
    'server_now',statement_timestamp(),'orders',coalesce((SELECT jsonb_agg(card ORDER BY rn) FROM cards),'[]'::jsonb))
  INTO v_result FROM page_info pi;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.agrimarket_passenger_order_sections_v1(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_passenger_order_sections_v1(uuid,text,integer) TO service_role;
COMMENT ON FUNCTION public.agrimarket_passenger_order_sections_v1(uuid,text,integer) IS
  'Read-only passenger order sections. Only trusted server may pass the authenticated passenger ID. Counts and page share one SQL snapshot; legacy history API unchanged.';
COMMIT;
