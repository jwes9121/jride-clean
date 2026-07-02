"use client";

import { useEffect, useMemo, useState } from "react";

type OptionRow = {
  id: string;
  code?: string;
  name?: string;
  category_name?: string;
  category_type?: string;
  tax_code_type?: string;
};

type OptionsResponse = {
  ok: boolean;
  company?: { id: string; legal_name?: string; trade_name?: string };
  business_units?: OptionRow[];
  locations?: OptionRow[];
  categories?: OptionRow[];
  tax_codes?: OptionRow[];
  error?: string;
  message?: string;
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function money(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "PHP 0.00";
  return "PHP " + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ManualExpensePage() {
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [expenseDate, setExpenseDate] = useState(todayYmd());
  const [businessUnitId, setBusinessUnitId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function loadOptions() {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/finance/expenses", { method: "GET", cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Failed to load options");
      setOptions(json);
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to load options"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOptions();
  }, []);

  const selectedCategory = useMemo(() => {
    return (options?.categories || []).find((c) => c.id === categoryId) || null;
  }, [options, categoryId]);

  async function submitExpense(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr("");
    setResult(null);

    try {
      if (!options?.company?.id) throw new Error("Company profile missing");
      if (!expenseDate) throw new Error("Expense date required");
      if (!description.trim()) throw new Error("Description required");
      if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error("Valid amount required");

      const res = await fetch("/api/admin/finance/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          company_id: options.company.id,
          business_unit_id: businessUnitId || null,
          location_id: locationId || null,
          expense_date: expenseDate,
          category_id: categoryId || null,
          category_name: selectedCategory?.category_name || null,
          description,
          amount: Number(amount),
          tax_code_id: taxCodeId || null,
          notes: notes || null,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || "Failed to create expense");

      setResult(json);
      setDescription("");
      setAmount("");
      setNotes("");
    } catch (ex: any) {
      setErr(String(ex?.message || ex || "Failed to create expense"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Manual Expense Entry</h1>
          <p className="mt-1 text-sm text-slate-600">
            Record JRide expenses as pending finance events. Nothing is posted to the books yet.
          </p>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading finance options...</div>
        ) : err ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>
        ) : (
          <form onSubmit={submitExpense} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Expense Date</span>
                <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Amount</span>
                <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Business Unit</span>
                <select value={businessUnitId} onChange={(e) => setBusinessUnitId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                  <option value="">None / Company-wide</option>
                  {(options?.business_units || []).map((b) => (
                    <option key={b.id} value={b.id}>{b.code ? `${b.code} - ` : ""}{b.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Location</span>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                  <option value="">None / Head Office</option>
                  {(options?.locations || []).map((l) => (
                    <option key={l.id} value={l.id}>{l.code ? `${l.code} - ` : ""}{l.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Category</span>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                  <option value="">Uncategorized</option>
                  {(options?.categories || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.category_name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Tax Code</span>
                <select value={taxCodeId} onChange={(e) => setTaxCodeId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                  <option value="">None / Pending Review</option>
                  {(options?.tax_codes || []).map((t) => (
                    <option key={t.id} value={t.id}>{t.code ? `${t.code} - ` : ""}{t.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-4 block">
              <span className="text-sm font-semibold text-slate-700">Description</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Example: Starlink monthly subscription" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>

            <label className="mt-4 block">
              <span className="text-sm font-semibold text-slate-700">Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>

            <div className="mt-5 flex items-center justify-between gap-4">
              <div className="text-sm text-slate-600">
                Amount preview: <span className="font-semibold text-slate-900">{money(amount)}</span>
              </div>
              <button disabled={saving} className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
                {saving ? "Saving..." : "Create Finance Event"}
              </button>
            </div>
          </form>
        )}

        {result?.event ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            Created pending finance event: <span className="font-semibold">{result.event.id}</span>. Check Finance Inbox.
          </div>
        ) : null}
      </div>
    </main>
  );
}
