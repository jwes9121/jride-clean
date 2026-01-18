"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type VerificationRow = {
  id: number;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  id_type: string | null;
  id_number: string | null;
  id_photo_url: string | null;
  selfie_photo_url: string | null;
  status: string;
  created_at: string;
  reject_reason?: string | null;
};

export default function AdminVerificationPage() {
  const [rows, setRows] = useState<VerificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadQueue = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("passenger_verifications")
      .select("*")
      .in("status", ["pending", "pre_approved_dispatcher"])
      .order("created_at", { ascending: true });

    if (error) {
      console.error("admin loadQueue error", error);
      alert("Error loading admin verification queue.");
      setRows([]);
    } else if (Array.isArray(data)) {
      setRows(data);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadQueue();
  }, []);

  const approve = async (id: number) => {
    const adminId =
      typeof window !== "undefined"
        ? window.prompt("Enter your admin ID (for log only):")
        : null;
    if (adminId === null) return; // allow cancel

    const { error } = await supabase
      .from("passenger_verifications")
      .update({
        status: "approved_admin",
        // only status to avoid unknown columns
      })
      .eq("id", id);

    if (error) {
      console.error("admin approve error", error);
      alert(`Error approving passenger: ${error.message}`);
      return;
    }

    loadQueue();
  };

  const reject = async (id: number) => {
    const adminId =
      typeof window !== "undefined"
        ? window.prompt("Enter your admin ID (for log only):")
        : null;
    if (adminId === null) return;

    const reason =
      typeof window !== "undefined"
        ? window.prompt("Reason for rejection:")
        : null;
    if (!reason) return;

    const { error } = await supabase
      .from("passenger_verifications")
      .update({
        status: "rejected",
        reject_reason: reason,
      })
      .eq("id", id);

    if (error) {
      console.error("admin reject error", error);
      alert(`Error rejecting passenger: ${error.message}`);
      return;
    }

    loadQueue();
  };

  return (
    <div className="p-4 text-sm">
      <h1 className="text-lg font-bold mb-2">Passenger Verification (Admin)</h1>

      {loading && <div>Loading…</div>}
      {!loading && rows.length === 0 && <div>No pending verifications.</div>}

      <div className="grid grid-cols-1 gap-4">
        {rows.map((r) => (
          <div key={r.id} className="border rounded p-3 bg-white shadow">
            <div className="font-semibold">{r.full_name}</div>
            <div className="text-xs text-gray-500">{r.phone}</div>
            <div className="text-xs mt-1">
              {r.id_type} — {r.id_number}
            </div>

            <div className="flex gap-3 mt-3">
              {r.id_photo_url && (
                <img
                  src={r.id_photo_url}
                  className="w-40 h-28 object-cover rounded border"
                />
              )}
              {r.selfie_photo_url && (
                <img
                  src={r.selfie_photo_url}
                  className="w-40 h-28 object-cover rounded border"
                />
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="px-3 py-1 bg-green-600 text-white rounded text-xs"
                disabled={r.status !== "pending"} onClick={() => approve(r.id)}
              >
                Approve
              </button>

              <button
                className="px-3 py-1 bg-red-600 text-white rounded text-xs"
                disabled={r.status !== "pending"} onClick={() => reject(r.id)}
              >
                Reject
              </button>

              <span className="ml-auto text-xs">
                Status: <span className={`inline-block rounded-full px-2 py-0.5 text-xs border ${
  r.status === "pending" ? "bg-yellow-50" :
  r.status === "pre_approved_dispatcher" ? "bg-blue-50" :
  r.status === "approved_admin" ? "bg-green-50" :
  "bg-red-50"
}`}>{r.status}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
