"use client";
import * as React from "react";
export const dynamic = "force-static";

export default function PassengerSignupPage() {
  const [fullName, setFullName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [town, setTown] = React.useState("");
  const [townOrigin, setTownOrigin] = React.useState("");
  const [barangayOrigin, setBarangayOrigin] = React.useState("");const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
setLoading(true);
      // JRIDE_TOWN_ORIGIN_REQUIRED_V1
      if (!String(townOrigin || "").trim()) {
        setLoading(false);
        alert("Town of origin is required.");
        return;
      }
    try {
      const res = await fetch("/api/public/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "passenger",
          full_name: fullName,
          phone,
          contact_email: contactEmail,
          address,
          town,
          town_origin: townOrigin,
          barangay_origin: barangayOrigin,
          password,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) return setMsg(j?.error || "Signup failed.");
      setMsg("Signup successful! Redirecting to login...");
      setTimeout(() => (window.location.href = "/passenger-login"), 800);
    } catch (err: any) {
      setMsg(err?.message || "Signup failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur">
        <h1 className="text-2xl font-semibold mb-1">Passenger Signup</h1>
        <p className="text-sm opacity-80 mb-6">Create your JRide passenger account.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-sm opacity-80">Full name</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Juan Dela Cruz"
              required
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Phone (PH)</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09XXXXXXXXX or +639XXXXXXXXX"
              required
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Email (optional)</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="you@email.com"
              type="email"
            />
          </div>

          <div>
            <label className="text-sm opacity-80">Address (optional)</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Barangay / Street"
            />
          </div>

                    <div>
            <label className="text-sm opacity-80">Town of origin (optional)</label>
            <select
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={townOrigin}
              onChange={(e) => setTownOrigin(e.target.value)}
            >
              <option value="">Select town (optional)</option>
              <option value="Lagawe">Lagawe</option>
              <option value="Hingyon">Hingyon</option>
              <option value="Banaue">Banaue</option>
              <option value="Kiangan">Kiangan</option>
              <option value="Lamut">Lamut</option>
              <option value="Other">Other</option>
            </select>
            <div className="mt-1 text-xs opacity-70">
              This is your origin/home town for your profile. It does NOT restrict where you can book.
            </div>
          </div>

          <div>
            <label className="text-sm opacity-80">Barangay of origin (optional)</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={barangayOrigin}
              onChange={(e) => setBarangayOrigin(e.target.value)}
              placeholder="Barangay (optional)"
            />
          </div><div>
            <label className="text-sm opacity-80">Password</label>
            <input
              className="mt-1 w-full rounded-xl bg-white/10 border border-white/10 px-3 py-2 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 6 characters"
              type="password"
              required
            />
          </div>

          {msg && (
            <div className="text-sm rounded-xl px-3 py-2 bg-white/10 border border-white/10">
              {msg}
            </div>
          )}

          {/* JRIDE_TOWN_ORIGIN_UI_V1 */}
<div className="mt-3 space-y-2">
  <label className="block text-sm font-medium">Town of origin <span className="text-red-600">*</span></label>
  <input
    value={townOrigin}
    onChange={(e) => setTownOrigin(e.target.value)}
    placeholder="e.g., Lagawe"
    className="w-full rounded-xl border border-black/10 px-3 py-2"
  />
  <label className="block text-sm font-medium">Barangay (optional)</label>
  <input
    value={barangayOrigin}
    onChange={(e) => setBarangayOrigin(e.target.value)}
    placeholder="e.g., Poblacion East"
    className="w-full rounded-xl border border-black/10 px-3 py-2"
  />
</div>
<button
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-4 py-2 font-semibold"
            type="submit"
          >
            {loading ? "Creating..." : "Create account"}
          </button>

          <div className="text-sm opacity-80 text-center">
            Already have an account?{" "}
            <a className="text-blue-300 underline" href="/passenger-login">
              Login
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}


