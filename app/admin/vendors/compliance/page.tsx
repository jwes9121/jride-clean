"use client";

import { useEffect, useMemo, useState } from "react";
import ActiveSanctionsPanel from "./ActiveSanctionsPanel";
import ComplianceExemptionsPanel from "./ComplianceExemptionsPanel";
import ManualVendorSuspensionPanel from "./ManualVendorSuspensionPanel";
import {
  clean,
  isActiveSanction,
  isSuspension,
} from "./shared";
import type { ManualSuspendPayload } from "./shared";

export default function VendorCompliancePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/vendor-compliance", {
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok !== true) {
        throw new Error(
          result?.message ||
            result?.error ||
            "Failed to load vendor compliance."
        );
      }
      setData(result);
    } catch (loadError: any) {
      setError(String(loadError?.message || loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(
    action: string,
    payload: Record<string, any> = {},
    successMessage = "Saved successfully."
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/vendor-compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok !== true) {
        throw new Error(result?.message || result?.error || "Action failed.");
      }
      setMessage(successMessage);
      await load();
      return true;
    } catch (actionError: any) {
      setError(String(actionError?.message || actionError));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const activeSanctions = useMemo(
    () =>
      (Array.isArray(data?.sanctions) ? data.sanctions : []).filter(
        isActiveSanction
      ),
    [data]
  );

  const activeSuspendedVendorIds = useMemo<Set<string>>(
    () =>
      new Set<string>(
        activeSanctions
          .filter(isSuspension)
          .map((row: any): string => clean(row?.vendor_id))
          .filter((vendorId: string) => vendorId.length > 0)
      ),
    [activeSanctions]
  );

  const vendors = useMemo(
    () => (Array.isArray(data?.vendors) ? data.vendors : []),
    [data]
  );
  const exemptions = useMemo(
    () => (Array.isArray(data?.exemptions) ? data.exemptions : []),
    [data]
  );
  const canManage = data?.can_manage === true;

  return (
    <main className="min-h-screen bg-slate-100 p-3 sm:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                JRide Admin
              </div>
              <h1 className="mt-1 text-2xl font-black text-slate-950">
                Vendor compliance and suspension control
              </h1>
              <p className="mt-1 max-w-4xl text-sm text-slate-600">
                System-verifiable thresholds are enforced automatically.
                Administrators review automatic sanctions only after a valid
                vendor dispute. Manual suspension remains available for other
                confirmed violations that cannot be decided from platform
                records alone.
              </p>
              {data ? (
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  Signed in as {data.viewer_email || data.viewer_role} (
                  {data.viewer_role})
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white"
            >
              Refresh
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
            <PolicyCard
              label="Unanswered orders"
              value="3 accumulated orders"
            />
            <PolicyCard
              label="Daily opening"
              value="3 consecutive missed days"
            />
            <PolicyCard label="First threshold" value="Automatic 7 days" />
            <PolicyCard
              label="Same offense again"
              value="Automatic 30 days"
            />
            <PolicyCard
              label="Manual review"
              value="Valid disputes only"
            />
          </div>
        </section>

        {error ? (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
            {message}
          </div>
        ) : null}
        {loading ? (
          <div className="rounded-xl border bg-white p-5 text-sm">
            Loading...
          </div>
        ) : null}

        {!loading ? (
          <>
            <ManualVendorSuspensionPanel
              vendors={vendors}
              activeSuspendedVendorIds={activeSuspendedVendorIds}
              busy={busy}
              canManage={canManage}
              onSuspend={(payload: ManualSuspendPayload, label: string) =>
                act(
                  "suspend_manual",
                  payload,
                  `${label} was suspended for the confirmed non-automatic violation.`
                )
              }
            />
            <ComplianceExemptionsPanel
              exemptions={exemptions}
              vendors={vendors}
              canManage={canManage}
              busy={busy}
              onAdd={(payload) =>
                act(
                  "add_exemption",
                  payload,
                  "The approved closure or exception was added."
                )
              }
              onRemove={(id) =>
                act(
                  "remove_exemption",
                  { id },
                  "The closure exemption was removed."
                )
              }
            />
            <ActiveSanctionsPanel
              sanctions={activeSanctions}
              canManage={canManage}
              busy={busy}
              onError={setError}
              onRevoke={(row, reason) =>
                act(
                  "revoke_sanction",
                  { sanction_id: row.id, note: reason },
                  "The sanction was revoked after review. The vendor store remains closed until manually reopened."
                )
              }
            />
          </>
        ) : null}
      </div>
    </main>
  );
}

function PolicyCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-slate-50 p-3 text-xs">
      <div className="text-slate-500">{label}</div>
      <div className="mt-1 font-black">{value}</div>
    </div>
  );
}
