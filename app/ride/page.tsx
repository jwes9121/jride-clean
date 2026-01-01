"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type CanBookInfo = {
  ok?: boolean;
  nightGate?: boolean;
  window?: string;

  verified?: boolean;
  verification_source?: string;
  verification_note?: string;

  wallet_ok?: boolean;
  wallet_locked?: boolean;
  wallet_balance?: number | null;
  min_wallet_required?: number | null;
  wallet_source?: string;
  wallet_note?: string;

  code?: string;
  message?: string;
};

type AssignInfo = {
  ok?: boolean;
  driver_id?: string | null;
  note?: string | null;
  update_ok?: boolean;
  update_error?: string | null;
};

type BookingRow = {
  id?: string | null;
  booking_code?: string | null;
  driver_id?: string | null;
  status?: string | null;
};

type BookResp = {
  ok?: boolean;
  booking_code?: string;
  code?: string;
  message?: string;
  booking?: BookingRow | null;
  assign?: AssignInfo | null;
};

function numOrNull(s: string): number | null {
  const t = String(s || "").trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function norm(s: any): string {
  return String(s || "").trim();
}

function normUpper
(s: any): string {
  return norm(s).toUpperCase();
}


function verificationStatusLabel(info: any): string {
  if (!info) return "Not submitted";
  if (info.verified === true) return "Verified";
  const note = String(info.verification_note || "").toLowerCase();
  if (note.indexOf("pre_approved_dispatcher") >= 0) return "Pending admin approval";
  if (note.indexOf("dispatcher") >= 0) return "Pending admin approval";
  if (note) return "Submitted (dispatcher review)";
  return "Not submitted";
}
export default function RidePage() {
  const router = useRouter();

  const [town, setTown] = React.useState("Lagawe");
  const [passengerName, setPassengerName] = React.useState("Test Passenger A");

  const [fromLabel, setFromLabel] = React.useState("Lagawe Public Market");
  const [toLabel, setToLabel] = React.useState("Lagawe Town Plaza");

  const [pickupLat, setPickupLat] = React.useState("16.7999");
  const [pickupLng, setPickupLng] = React.useState("121.1175");
  const [dropLat, setDropLat] = React.useState("16.8016");
  const [dropLng, setDropLng] = React.useState("121.1222");

  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<string>("");

  const [activeCode, setActiveCode] = React.useState<string>("");
  const [liveStatus, setLiveStatus] = React.useState<string>("");
  const [liveDriverId, setLiveDriverId] = React.useState<string>("");
  const [liveUpdatedAt, setLiveUpdatedAt] = React.useState<number | null>(null);
  const [liveErr, setLiveErr] = React.useState<string>("");
  const pollRef = React.useRef<any>(null);

  const [canInfo, setCanInfo] = React.useState<CanBookInfo | null>(null);
  const [canInfoErr, setCanInfoErr] = React.useState<string>("");

  const [showVerifyPanel, setShowVerifyPanel] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function getJson(url: string) {
    const r = await fetch(url, { method: "GET", cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as any;
    return { ok: r.ok, status: r.status, json: j };
  }

  async function postJson(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as any;
    return { ok: r.ok, status: r.status, json: j };
  }

  async function refreshCanBook() {
    setCanInfoErr("");
    try {
      const r = await getJson("/api/public/passenger/can-book");
      if (!r.ok) {
        setCanInfoErr("CAN_BOOK_INFO_FAILED: HTTP " + r.status);
        setCanInfo(null);
        return;
      }
      setCanInfo(r.json as CanBookInfo);
    } catch (e: any) {
      setCanInfoErr("CAN_BOOK_INFO_ERROR: " + String(e?.message || e));
      setCanInfo(null);
    }
  }

  React.useEffect(() => {
    refreshCanBook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // Live status polling:
    // GET /api/public/passenger/booking?code=BOOKING_CODE
    if (!activeCode) return;

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        setLiveErr("");
        const url = "/api/public/passenger/booking?code=" + encodeURIComponent(activeCode);
        const resp = await getJson(url);

        if (!resp.ok) {
          const msg =
            (resp.json && (resp.json.message || resp.json.error))
              ? String(resp.json.message || resp.json.error)
              : "HTTP " + String(resp.status);
          setLiveErr("BOOKING_POLL_FAILED: " + msg);
          return;
        }

        const j = resp.json || {};
        const b = (j.booking || (j.data && j.data.booking) || (j.payload && j.payload.booking) || j) as any;

        const st = String((b && b.status) ? b.status : (j.status || "")) || "";
        const did = String((b && b.driver_id) ? b.driver_id : (j.driver_id || "")) || "";

        setLiveStatus(st);
        setLiveDriverId(did);
        setLiveUpdatedAt(Date.now());

        const terminal = st === "completed" || st === "cancelled";
        if (terminal && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (e: any) {
        setLiveErr("BOOKING_POLL_ERROR: " + String(e?.message || e));
      }
    }

    tick();
    pollRef.current = setInterval(() => { tick(); }, 3000);

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeCode]);

  const verified = !!canInfo?.verified;
  const nightGate = !!canInfo?.nightGate;

  const walletOk = canInfo?.wallet_ok;
  const walletLocked = !!canInfo?.wallet_locked;

  function pill(text: string, good: boolean) {
    return (
      <span
        className={
          "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold " +
          (good ? "bg-green-600 text-white" : "bg-slate-200 text-slate-800")
        }
      >
        {text}
      </span>
    );
  }

  const walletPillText =
    walletOk === undefined ? "Wallet: (no data)" : walletOk ? "Wallet: OK" : walletLocked ? "Wallet: LOCKED" : "Wallet: LOW";
  const walletPillGood = walletOk === true;

  const canCode = normUpper(canInfo?.code);
  const canMsg = norm(canInfo?.message);

  const unverifiedBlocked =
    !verified &&
    (
      nightGate ||
      canCode.indexOf("UNVERIFIED") >= 0 ||
      canCode.indexOf("VERIFY") >= 0 ||
      canMsg.toLowerCase().indexOf("verify") >= 0
    );

  const walletBlocked =
    walletOk === false || walletLocked === true;

  const allowSubmit = !busy && !unverifiedBlocked && !walletBlocked;

  function blockTitle(): string {
    if (unverifiedBlocked) return "Verification required";
    if (walletBlocked) return "Wallet requirement not met";
    if (canCode || canMsg) return "Booking blocked";
    return "Booking blocked";
  }

  function blockBody(): string {
    if (unverifiedBlocked) {
      const win = norm(canInfo?.window);
      const extra = win ? (" Night gate window: " + win + ".") : "";
      return "Your account is not verified. Ride booking is restricted during night gate hours until verification is approved.";
    }
    if (walletBlocked) {
      const bal = canInfo?.wallet_balance;
      const min = canInfo?.min_wallet_required;
      const locked = !!canInfo?.wallet_locked;
      const parts: string[] = [];
      parts.push("Your wallet does not meet the minimum requirement to book a ride.");
      parts.push("Balance: " + String(bal ?? "null") + " | Min required: " + String(min ?? "null") + " | Locked: " + String(locked));
      return parts.join(" ");
    }
    if (canCode || canMsg) {
      return (canCode ? (canCode + ": ") : "") + (canMsg || "Not allowed right now.");
    }
    return "Not allowed right now.";
  }

  function verifyRequestText(): string {
    const now = new Date();
    const lines: string[] = [];
    lines.push("JRIDE VERIFICATION REQUEST");
    lines.push("Passenger name: " + passengerName);
    lines.push("Town: " + town);
    lines.push("Requested at: " + now.toISOString());
    lines.push("Reason: Please verify my passenger account so I can book rides.");
    lines.push("Notes: " + (nightGate ? "Night gate is ON and booking is blocked while unverified." : "Booking is blocked while unverified."));
    return lines.join("\n");
  }

  async function copyVerifyRequest() {
    setCopied(false);
    try {
      const text = verifyRequestText();
      if (navigator && (navigator as any).clipboard && (navigator as any).clipboard.writeText) {
        await (navigator as any).clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        return;
      }
    } catch {
      // ignore
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = verifyRequestText();
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function submit() {
    setResult("");
    setBusy(true);

    try {
      // 1) Gate check (server-authoritative)
      const can = await postJson("/api/public/passenger/can-book", {
        town,
        service: "ride",
      });

      if (!can.ok) {
        const cj = (can.json || {}) as CanBookInfo;
        const code = normUpper((cj as any).code || (cj as any).error_code);
        const msg = norm((cj as any).message) || "Not allowed";

        setResult("CAN_BOOK_BLOCKED: " + (code || "BLOCKED") + " - " + msg);

        // Refresh visible status pills/cards
        await refreshCanBook();

        // If this looks like an unverified block, open the UX panel automatically
        const looksUnverified =
          (!cj.verified && (!!cj.nightGate)) ||
          code.indexOf("UNVERIFIED") >= 0 ||
          code.indexOf("VERIFY") >= 0 ||
          msg.toLowerCase().indexOf("verify") >= 0;

        if (looksUnverified) setShowVerifyPanel(true);
        return;
      }

      // 2) Create booking (no debug flags)
      const book = await postJson("/api/public/passenger/book", {
        passenger_name: passengerName,
        town,
        from_label: fromLabel,
        to_label: toLabel,
        pickup_lat: numOrNull(pickupLat),
        pickup_lng: numOrNull(pickupLng),
        dropoff_lat: numOrNull(dropLat),
        dropoff_lng: numOrNull(dropLng),
        service: "ride",
      });

      if (!book.ok) {
        const bj = (book.json || {}) as BookResp;
        setResult("BOOK_FAILED: " + (bj.code || "FAILED") + " - " + (bj.message || "Insert failed"));
        return;
      }

      const bj = (book.json || {}) as BookResp;
      const lines: string[] = [];

      lines.push("BOOKED_OK");
      if (bj.booking_code) lines.push("booking_code: " + bj.booking_code);
      if (bj.booking && bj.booking.id) lines.push("booking_id: " + String(bj.booking.id));
      if (bj.booking && bj.booking.status) lines.push("status: " + String(bj.booking.status));
      if (bj.booking && bj.booking.driver_id) lines.push("driver_id: " + String(bj.booking.driver_id));

      if (bj.assign) {
        lines.push("assign.ok: " + String(!!bj.assign.ok));
        if (bj.assign.driver_id) lines.push("assign.driver_id: " + String(bj.assign.driver_id));
        if (bj.assign.note) lines.push("assign.note: " + String(bj.assign.note));
        if (bj.assign.update_ok !== undefined) lines.push("assign.update_ok: " + String(!!bj.assign.update_ok));
        if (bj.assign.update_error) lines.push("assign.update_error: " + String(bj.assign.update_error));
      } else {
        lines.push("assign: (none)");
      }

      setResult(lines.join("\n"));

      // 3) Start live polling after booking (if we have a booking_code)
      const code = norm((bj.booking && bj.booking.booking_code) ? bj.booking.booking_code : (bj.booking_code || ""));
      if (code) {
        setActiveCode(code);
        setLiveStatus(String((bj.booking && bj.booking.status) ? bj.booking.status : ""));
        setLiveDriverId(String((bj.booking && bj.booking.driver_id) ? bj.booking.driver_id : ""));
        setLiveUpdatedAt(Date.now());
      }

      await refreshCanBook();
    } catch (e: any) {
      setResult("ERROR: " + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Book a Ride</h1>
          <button
            type="button"
            onClick={() => router.push("/passenger")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
          >
            Back
          </button>
        </div>

        <p className="mt-2 text-sm opacity-70">Phase 11B: unverified UX + verification request (UI-only).</p>

        <div className="mt-3 flex flex-wrap gap-2 items-center">
          {pill("Verified: " + (verified ? "YES" : "NO"), verified)}
          {pill("Night gate now: " + (nightGate ? "ON" : "OFF"), !nightGate)}
          {pill(walletPillText, walletPillGood)}
          <button
            type="button"
            onClick={refreshCanBook}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-1 text-xs font-semibold"
          >
            Refresh status
          </button>
        </div>

        {canInfoErr ? (
          <div className="mt-3 text-xs font-mono whitespace-pre-wrap rounded-xl border border-black/10 p-3">
            {canInfoErr}
          </div>
        ) : null}

        {(unverifiedBlocked || walletBlocked || (canCode || canMsg)) ? (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-amber-900">{blockTitle()}</div>
                <div className="mt-1 text-sm text-amber-900/80">
                  {blockBody()}
                </div>
                {(canCode || canMsg) ? (
                  <div className="mt-2 text-xs text-amber-900/70">
                    Details: <span className="font-mono">{(canCode || "BLOCKED")}</span>{canMsg ? (" - " + canMsg) : ""}
                  </div>
                ) : null}
              </div>

              {unverifiedBlocked ? (
                <button
                  type="button"
                  className="rounded-xl bg-amber-900 text-white px-4 py-2 text-sm font-semibold hover:bg-amber-800"
                  onClick={() => router.push("/verify")}
                >
                  Go to verification
                </button>
              ) : null}
            </div>

            {showVerifyPanel && unverifiedBlocked ? (
  <div className="mt-4 rounded-xl border border-amber-200 bg-white p-3">
    <div className="font-semibold text-sm">Verification required</div>

    <div className="mt-2 text-xs opacity-70">
      Current status: <b>{verificationStatusLabel(canInfo)}</b>
    </div>

    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        className="rounded-xl bg-black text-white px-4 py-2 text-xs font-semibold hover:bg-black/90"
        onClick={() => router.push("/verify")}
      >
        Go to verification
      </button>

      <button
        type="button"
        className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 text-xs font-semibold"
        onClick={refreshCanBook}
      >
        Refresh status
      </button>
    </div>
  </div>
) : null}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-1 gap-3">
          {canInfo && canInfo.verification_note ? (
            <div className="text-xs opacity-70 rounded-xl border border-black/10 p-3">
              <div className="font-semibold">Verification lookup</div>
              <div className="mt-1">
                Source: <span className="font-mono">{String(canInfo.verification_source || "")}</span>
              </div>
              <div className="mt-1">{String(canInfo.verification_note || "")}</div>
            </div>
          ) : null}

          {canInfo && canInfo.wallet_note !== undefined ? (
            <div className="text-xs opacity-70 rounded-xl border border-black/10 p-3">
              <div className="font-semibold">Wallet precheck</div>
              <div className="mt-1">
                Source: <span className="font-mono">{String(canInfo.wallet_source || "")}</span>
              </div>
              <div className="mt-1">
                Balance: <span className="font-mono">{String(canInfo.wallet_balance ?? "null")}</span> / Min required:{" "}
                <span className="font-mono">{String(canInfo.min_wallet_required ?? "null")}</span> / Locked:{" "}
                <span className="font-mono">{String(!!canInfo.wallet_locked)}</span>
              </div>
              <div className="mt-1">{String(canInfo.wallet_note || "")}</div>
            </div>
          ) : null}
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-black/10 p-4">
            <div className="font-semibold mb-3">Passenger</div>

            <label className="block text-xs font-semibold opacity-70 mb-1">Passenger name</label>
            <input
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={passengerName}
              onChange={(e) => setPassengerName(e.target.value)}
            />

            <label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Town</label>
            <select
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={town}
              onChange={(e) => setTown(e.target.value)}
            >
              <option value="Lagawe">Lagawe</option>
              <option value="Kiangan">Kiangan</option>
              <option value="Lamut">Lamut</option>
              <option value="Hingyon">Hingyon</option>
              <option value="Banaue">Banaue</option>
            </select>
          </div>

          <div className="rounded-2xl border border-black/10 p-4">
            <div className="font-semibold mb-3">Route</div>

            <label className="block text-xs font-semibold opacity-70 mb-1">Pickup label</label>
            <input
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={fromLabel}
              onChange={(e) => setFromLabel(e.target.value)}
            />

            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Pickup lat</label>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2"
                  value={pickupLat}
                  onChange={(e) => setPickupLat(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Pickup lng</label>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2"
                  value={pickupLng}
                  onChange={(e) => setPickupLng(e.target.value)}
                />
              </div>
            </div>

            <label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Dropoff label</label>
            <input
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={toLabel}
              onChange={(e) => setToLabel(e.target.value)}
            />

            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Dropoff lat</label>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2"
                  value={dropLat}
                  onChange={(e) => setDropLat(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Dropoff lng</label>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2"
                  value={dropLng}
                  onChange={(e) => setDropLng(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3 items-center">
          <button
            type="button"
            disabled={!allowSubmit}
            onClick={submit}
            className={
              "rounded-xl px-5 py-2 font-semibold text-white " +
              (!allowSubmit ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500")
            }
            title={!allowSubmit ? "Booking is blocked by rules above" : "Submit booking"}
          >
            {busy ? "Booking..." : "Submit booking"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => setResult("")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
          >
            Clear
          </button>

          {unverifiedBlocked ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => router.push("/verify")}
              className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
            >
              Go to verification
            </button>
          ) : null}
        </div>

        {result ? (
          <div className="mt-4 rounded-xl border border-black/10 bg-white p-3 text-sm">
            <div className="font-semibold">Result</div>
            <div className="mt-1 font-mono text-xs whitespace-pre-wrap">{result}</div>
          </div>
        ) : null}

        {activeCode ? (
          <div className="mt-4 rounded-xl border border-black/10 bg-white p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">Trip status (live)</div>
              <button
                className="text-xs rounded-lg border border-black/10 px-2 py-1 hover:bg-black/5"
                onClick={() => {
                  setActiveCode("");
                  setLiveStatus("");
                  setLiveDriverId("");
                  setLiveUpdatedAt(null);
                  setLiveErr("");
                }}
              >
                Clear
              </button>
            </div>

            <div className="mt-1 text-xs font-mono">
              code: <span className="font-semibold">{activeCode}</span>
            </div>

            <div className="mt-2">
              <span className="text-xs opacity-70">status:</span>{" "}
              <span className="font-mono text-xs">{liveStatus || "(loading)"}</span>
            </div>

            <div className="mt-1">
              <span className="text-xs opacity-70">driver_id:</span>{" "}
              <span className="font-mono text-xs">{liveDriverId || "(none)"}</span>
            </div>

            <div className="mt-1 text-xs opacity-70">
              last update:{" "}
              {liveUpdatedAt ? Math.max(0, Math.floor((Date.now() - liveUpdatedAt) / 1000)) + "s ago" : "--"}
            </div>

            {liveErr ? (
              <div className="mt-2 rounded-lg border border-red-500/20 bg-red-50 p-2 text-xs font-mono">
                {liveErr}
              </div>
            ) : null}

            <div className="mt-2 text-xs opacity-70">
              Polling: /api/public/passenger/booking?code=...
            </div>
          </div>
        ) : null}

        <div className="mt-6 text-xs opacity-70">Next: connect request-verification API (Phase 11C).</div>
      </div>
    </main>
  );
}