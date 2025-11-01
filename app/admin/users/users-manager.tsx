"use client";
import * as React from "react";

type Row = { email: string; role: "admin" | "dispatcher" | "user"; updated_at: string };

export default function UsersManager(): JSX.Element {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [busy, setBusy] = React.useState<boolean>(false);
  const [email, setEmail] = React.useState<string>("");
  const [role, setRole] = React.useState<"admin" | "dispatcher" | "user">("dispatcher");
  const [error, setError] = React.useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/admin/user-roles", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "Failed to load");
      const list = Array.isArray(data.rows) ? data.rows as Row[] : [];
      list.sort(function(a, b){ return a.email.localeCompare(b.email); });
      setRows(list);
    } catch (e: any) {
      setError(e && e.message ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function upsert(): Promise<void> {
    if (!email) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/admin/user-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "Failed to save");

      setRows(function(prev){
        const i = prev.findIndex(function(r){ return r.email === data.row.email; });
        if (i >= 0) { const next = prev.slice(); next[i] = data.row; return next; }
        return prev.concat([data.row]);
      });

      setEmail("");
      setRole("dispatcher");
    } catch (e: any) {
      setError(e && e.message ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function removeEmail(emailToDelete: string): Promise<void> {
    if (!window.confirm("Remove " + emailToDelete + "?")) return;
    setBusy(true); setError(null);
    try {
      const url = "/api/admin/user-roles?email=" + encodeURIComponent(emailToDelete);
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "Failed to delete");
      setRows(function(prev){ return prev.filter(function(r){ return r.email !== emailToDelete; }); });
    } catch (e: any) {
      setError(e && e.message ? e.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(function(){ load(); }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl shadow p-4 border">
        <h2 className="font-medium mb-3">Add / Update</h2>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <label className="block text-sm mb-1">Email</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={email}
              onChange={function(e){ setEmail(e.target.value); }}
              placeholder="user@example.com"
              type="email"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Role</label>
            <select
              className="border rounded-lg px-3 py-2"
              value={role}
              onChange={function(e){ setRole(e.target.value as any); }}
            >
              <option value="dispatcher">dispatcher</option>
              <option value="admin">admin</option>
              <option value="user">user</option>
            </select>
          </div>
          <button
            onClick={upsert}
            disabled={busy || !email}
            className="px-4 py-2 rounded-xl border shadow disabled:opacity-50"
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
        {error ? <p className="text-red-600 mt-3">{error}</p> : null}
      </div>

      <div className="rounded-2xl shadow p-4 border">
        <h2 className="font-medium mb-3">Current Access</h2>
        {loading ? (
          <p>Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-600">No rows yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Email</th>
                <th className="py-2">Role</th>
                <th className="py-2">Updated</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(function(r){
                return (
                  <tr key={r.email} className="border-b">
                    <td className="py-2">{r.email}</td>
                    <td className="py-2">{r.role}</td>
                    <td className="py-2">{new Date(r.updated_at).toLocaleString()}</td>
                    <td className="py-2">
                      <button
                        onClick={function(){ removeEmail(r.email); }}
                        className="px-3 py-1 rounded-lg border shadow"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

