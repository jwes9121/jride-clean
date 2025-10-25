"use client";
export const dynamic = "force-static";

import { useState } from "react";

export default function VerificationPage() {
  const [code, setCode] = useState("");
  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-3">Admin Verification</h1>
      <label className="block text-sm mb-2">Enter verification code</label>
      <input
        className="border rounded px-3 py-2 w-full mb-3"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="XXXXXX"
        inputMode="numeric"
      />
      <button
        className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
        disabled={!code}
        onClick={() => alert(`Submitted code ${code}`)}
      >
        Verify
      </button>
    </main>
  );
}
