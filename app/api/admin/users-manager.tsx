// app/admin/users/users-manager.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type Row = { email: string; role: "admin" | "dispatcher" | "user"; updated_at: string };

export default function UsersManager() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "dispatcher" | "user">("dispatcher");
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.email.localeCompare(b.email)),
    [rows]
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/user-roles", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load");
      setRows(data.rows || []);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function upsert() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/user-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save");

      // update local
      setRows((prev) => {
        const i = prev.findIndex((r) => r.email === data.row.email);
        if (i >= 0) {
          const next = [...prev];
          next[i] = data.row;
          return next;
        }
        return [...prev, data.row];
      });

      setEmail("");
      setRole("dispatcher");
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(emailToDelete: string) {
    if (!confirm(`Remove ${emailToDelete}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/user-roles?email=${encodeURIComponent(emailToDelete)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to delete");
      setRows((prev) => prev.filter((r) => r.email !== emailToDelete));
    } catch (e: any) {
      setError(e.message || "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      {/* Add / Update */}
      <div className="rounded-2xl shadow p-4 border">
        <h2 className="font-medium mb-3">Add / Update</h2>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <label className="block text-sm mb-1">Email</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              type="email"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Role</label>
            <select
              className="border rounded-lg px-3 py-2"
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
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

        {error && <p className="text-red-600 mt-3">{error}</p>}
      </div>

      {/* List */}
      <div className="rounded-2xl shadow p-4 border">
        <h2 className="font-medium mb-3">Current Access</h2>
        {loading ? (
          <p>Loading...</p>
        ) : sorted.length === 0 ? (
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
              {sorted.map((r) => (
                <tr key={r.email} className="border-b">
                  <td className="py-2">{r.email}</td>
                  <td className="py-2">{r.role}</td>
                  <td className="py-2">{new Date(r.updated_at).toLocaleString()}</td>
                  <td className="py-2">
                    <button
                      onClick={() => remove(r.email)}
                      className="px-3 py-1 rounded-lg border shadow"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
