"use client";
export const dynamic = "force-static";

import { useState } from "react";
export default function ProfileSetupPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const save = ()=>alert(`Saved\nName: ${name}\nPhone: ${phone}`);
  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-4">Complete your profile</h1>
      <label className="block text-sm mb-1">Full name</label>
      <input className="border rounded px-3 py-2 w-full mb-3" value={name} onChange={e=>setName(e.target.value)} />
      <label className="block text-sm mb-1">Phone</label>
      <input className="border rounded px-3 py-2 w-full mb-4" value={phone} onChange={e=>setPhone(e.target.value)} inputMode="tel" />
      <button className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-60" disabled={!name||!phone} onClick={save}>Save</button>
    </main>
  );
}
