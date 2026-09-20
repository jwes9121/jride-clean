// Call only after the caller has scoped orders to the authenticated role.
export async function loadOrderCustomers(admin: any, orders: any[]) {
  const userIds = Array.from(new Set(orders.map(row => row.customer_user_id).filter(Boolean)));
  const addressIds = Array.from(new Set(orders.map(row => row.delivery_address_id).filter(Boolean)));
  const [people, addresses] = await Promise.all([
    userIds.length ? admin.from("passenger_verifications").select("user_id,full_name,phone").in("user_id", userIds)
      : { data: [], error: null },
    addressIds.length ? admin.from("passenger_addresses").select("id,created_by_user_id,label,address_text,landmark").in("id", addressIds)
      : { data: [], error: null },
  ]);
  if (people.error || addresses.error) throw new Error("AGRIMARKET_ORDER_CUSTOMER_READ_FAILED");
  const personById = new Map<string, any>((people.data || []).map((row: any) => [row.user_id, row]));
  const addressById = new Map<string, any>((addresses.data || []).map((row: any) => [row.id, row]));
  return new Map<string, { name: string | null; phone: string | null; delivery_label: string | null; address_text: string | null; landmark: string | null }>(orders.map(row => {
    const person = personById.get(row.customer_user_id);
    const candidate = addressById.get(row.delivery_address_id);
    const address = candidate?.created_by_user_id === row.customer_user_id ? candidate : null;
    return [row.id, {
      name: person?.full_name || null,
      phone: person?.phone || null,
      // Keep the destination saved on the booking ahead of a later address edit.
      delivery_label: row.delivery_label || address?.label || null,
      address_text: address?.address_text || null,
      landmark: address?.landmark || null,
    }];
  }));
}

export function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
