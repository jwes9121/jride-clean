type SupabaseLike = {
  from: (table: string) => any;
};

type CreateExpenseEventInput = {
  adminSb: SupabaseLike;
  companyId: string;
  businessUnitId?: string | null;
  locationId?: string | null;
  createdBy?: string | null;
  expenseDate: string;
  categoryId?: string | null;
  categoryName?: string | null;
  description: string;
  amount: number;
  taxCodeId?: string | null;
  notes?: string | null;
};

function s(v: any) {
  return String(v ?? "").trim();
}

function stableSourceId() {
  return "manual_expense_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
}

export async function createManualExpenseFinanceEvent(input: CreateExpenseEventInput) {
  const companyId = s(input.companyId);
  const description = s(input.description);
  const expenseDate = s(input.expenseDate);
  const amount = Number(input.amount);

  if (!companyId) return { ok: false, error: "company_id_required" };
  if (!expenseDate) return { ok: false, error: "expense_date_required" };
  if (!description) return { ok: false, error: "description_required" };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "amount_invalid" };

  const sourceId = stableSourceId();

  const payload = {
    expense_date: expenseDate,
    event_at: expenseDate + "T00:00:00.000Z",
    category_id: input.categoryId || null,
    category_name: input.categoryName || null,
    description,
    amount,
    tax_code_id: input.taxCodeId || null,
    notes: input.notes || null,
  };

  const insertRes = await input.adminSb
    .from("finance_events")
    .insert({
      company_id: companyId,
      business_unit_id: input.businessUnitId || null,
      location_id: input.locationId || null,
      source_type: "manual_expense",
      source_id: sourceId,
      event_type: "MANUAL_EXPENSE",
      payload,
      status: "pending",
      created_by: input.createdBy || null,
    })
    .select("id,company_id,source_type,source_id,event_type,status,payload,created_at")
    .single();

  if (insertRes.error) {
    return { ok: false, error: "finance_event_create_failed", message: insertRes.error.message };
  }

  return { ok: true, event: insertRes.data };
}
