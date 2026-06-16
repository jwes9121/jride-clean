"use client";

import * as React from "react";

type Vendor = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string | null;
  status?: string | null;
};

export default function VendorsPage() {
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [vendors, setVendors] = React.useState<Vendor[]>([]);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [statusBusy, setStatusBusy] = React.useState<string | null>(null);
  const [statusMsg, setStatusMsg] = React.useState<Record<string, string>>({});

  const [seedName, setSeedName] = React.useState<Record<string, string>>({});
  const [seedPrice, setSeedPrice] = React.useState<Record<string, string>>({});
  const [seedDesc, setSeedDesc] = React.useState<Record<string, string>>({});
  const [seedBusy, setSeedBusy] = React.useState<string | null>(null);
  const [seedMsg, setSeedMsg] = React.useState<Record<string, string>>({});

  const baseUrl =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://app.jride.net";

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/vendors", { cache: "no-store" });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || "Failed to load vendors");
      }
      setVendors(Array.isArray(j.vendors) ? j.vendors : []);
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to load"));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function updateMarketplaceStatus(vendorId: string, status: string) {
    setStatusBusy(vendorId);
    setStatusMsg((m) => ({ ...m, [vendorId]: "" }));

    try {
      const res = await fetch("/api/admin/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor_id: vendorId, status }),
      });

      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || "Failed to update status");
      }

      setVendors((rows) =>
        rows.map((v) => (v.id === vendorId ? { ...v, status } : v))
      );
      setStatusMsg((m) => ({ ...m, [vendorId]: "Saved" }));
      setTimeout(() => setStatusMsg((m) => ({ ...m, [vendorId]: "" })), 1500);
    } catch (e: any) {
      setStatusMsg((m) => ({
        ...m,
        [vendorId]: String(e?.message || e || "Failed"),
      }));
    } finally {
      setStatusBusy(null);
    }
  }

  async function seedMenuItem(vendorId: string) {
    const name = String(seedName[vendorId] || "").trim();
    const price = String(seedPrice[vendorId] || "").trim();
    const description = String(seedDesc[vendorId] || "").trim();

    if (!name) {
      setSeedMsg((m) => ({ ...m, [vendorId]: "Name required" }));
      return;
    }
    if (!price || isNaN(Number(price))) {
      setSeedMsg((m) => ({ ...m, [vendorId]: "Price must be a number" }));
      return;
    }

    setSeedBusy(vendorId);
    setSeedMsg((m) => ({ ...m, [vendorId]: "" }));

    try {
      const res = await fetch("/api/admin/vendor-menu-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_id: vendorId,
          name,
          price: Number(price),
          description: description || null,
          sort_order: 0,
        }),
      });

      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || "Failed to seed menu item");
      }

      setSeedMsg((m) => ({ ...m, [vendorId]: "Added OK" }));
      setSeedName((s) => ({ ...s, [vendorId]: "" }));
      setSeedPrice((s) => ({ ...s, [vendorId]: "" }));
      setSeedDesc((s) => ({ ...s, [vendorId]: "" }));

      setTimeout(() => setSeedMsg((m) => ({ ...m, [vendorId]: "" })), 1500);
    } catch (e: any) {
      setSeedMsg((m) => ({
        ...m,
        [vendorId]: String(e?.message || e || "Failed"),
      }));
    } finally {
      setSeedBusy(null);
    }
  }

  function vendorLink(vendorId: string) {
    return baseUrl + "/vendor-orders?vendor_id=" + encodeURIComponent(vendorId);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(text);
      setTimeout(() => setCopied(null), 1200);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">Vendors</h1>
            <p className="text-sm opacity-70">
              Copy a vendor's private link once. After opening, the device will remember vendor_id.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm hover:bg-black/5"
          >
            Refresh
          </button>
        </div>

        {err ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {err}
          </div>
        ) : null}

        <div className="rounded-2xl border border-black/10 bg-white shadow-sm">
          <div className="border-b border-black/5 px-4 py-3 text-sm font-medium">
            {loading ? "Loading..." : "Total: " + vendors.length}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr className="border-b border-black/5">
                  <th className="px-4 py-2">Display name</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Vendor ID</th>
                  <th className="px-4 py-2">Marketplace status</th>
                  <th className="px-4 py-2">Link</th>
                </tr>
              </thead>
              <tbody>
                {!loading && vendors.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 opacity-70" colSpan={5}>
                      No vendors found in vendor_accounts.
                    </td>
                  </tr>
                ) : null}

                {vendors.map((v) => {
                  const link = vendorLink(v.id);
                  const isCopied = copied === link;

                  return (
                    <tr key={v.id} className="border-b border-black/5">
                      <td className="px-4 py-2 font-medium">{v.display_name || "-"}</td>
                      <td className="px-4 py-2">{v.email || "-"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{v.id}</td>
                      <td className="px-4 py-2">
                        <select
                          value={v.status || ""}
                          disabled={statusBusy === v.id}
                          onChange={(e) => updateMarketplaceStatus(v.id, e.target.value)}
                          className="rounded border border-black/10 bg-white px-2 py-1 text-xs disabled:opacity-60"
                        >
                          <option value="" disabled>
                            Select status
                          </option>
                          <option value="pilot_lagawe">Active Batch</option>
                          <option value="batch2">Coming Soon</option>
                          <option value="removed_from_pilot">Hidden</option>
                        </select>
                        {statusMsg[v.id] ? (
                          <div className="mt-1 text-[11px] opacity-70">{statusMsg[v.id]}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => copy(link)}
                            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs hover:bg-black/5"
                          >
                            {isCopied ? "Copied" : "Copy link"}
                          </button>
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs hover:bg-black/5"
                          >
                            Open
                          </a>
                          <div className="mt-2">
                            <a href={link} target="_blank" rel="noreferrer" className="inline-block">
                              <img
                                src={qrUrl(link)}
                                alt="QR"
                                className="h-[84px] w-[84px] rounded border border-black/10 bg-white"
                              />
                            </a>
                            <div className="mt-1 text-[11px] opacity-60">Scan to open</div>
                          </div>
                        </div>
                        <div className="mt-1 break-all font-mono text-[11px] opacity-70">{link}</div>

                        <div className="mt-3 rounded-lg border border-black/10 bg-slate-50 p-2">
                          <div className="text-[11px] font-medium opacity-80">Seed menu item (admin)</div>
                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                            <input
                              value={seedName[v.id] || ""}
                              onChange={(e) => setSeedName((s) => ({ ...s, [v.id]: e.target.value }))}
                              placeholder="Item name"
                              className="rounded border border-black/10 bg-white px-2 py-1 text-xs"
                            />
                            <input
                              value={seedPrice[v.id] || ""}
                              onChange={(e) => setSeedPrice((s) => ({ ...s, [v.id]: e.target.value }))}
                              placeholder="Price"
                              inputMode="decimal"
                              className="rounded border border-black/10 bg-white px-2 py-1 text-xs"
                            />
                            <input
                              value={seedDesc[v.id] || ""}
                              onChange={(e) => setSeedDesc((s) => ({ ...s, [v.id]: e.target.value }))}
                              placeholder="Description (optional)"
                              className="rounded border border-black/10 bg-white px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              disabled={seedBusy === v.id}
                              onClick={() => seedMenuItem(v.id)}
                              className="rounded border border-black/10 bg-white px-3 py-1 text-xs hover:bg-black/5 disabled:opacity-60"
                            >
                              {seedBusy === v.id ? "Adding..." : "Add item"}
                            </button>
                          </div>
                          {seedMsg[v.id] ? (
                            <div className="mt-2 text-[11px] opacity-80">{seedMsg[v.id]}</div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Tip: Send the "Copy link" URL to the vendor. They open it once and bookmark /vendor-orders after.
        </div>
      </div>
    </main>
  );
}

function qrUrl(text: string) {
  return "https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=" + encodeURIComponent(text);
}