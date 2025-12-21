"use client";

import React, { useMemo } from "react";

type Props = {
  trip: any | null;
};

function asNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(v: any) {
  const n = asNum(v);
  if (n === null) return "--";
  return n.toFixed(2);
}

/**
 * Schema-aligned:
 * bookings has verified_fare, proposed_fare, total_errand_fare, and components:
 * base_fee, distance_fare, extra_stop_fee, waiting_fee
 */
function computeFareFromBooking(trip: any): number | null {
  const verified = asNum(trip?.verified_fare);
  if (verified !== null) return verified;

  const proposed = asNum(trip?.proposed_fare);
  if (proposed !== null) return proposed;

  const errandTotal = asNum(trip?.total_errand_fare);
  if (errandTotal !== null) return errandTotal;

  const baseFee = asNum(trip?.base_fee) ?? 0;
  const distFare = asNum(trip?.distance_fare) ?? 0;
  const extraStop = asNum(trip?.extra_stop_fee) ?? 0;
  const waitingFee = asNum(trip?.waiting_fee) ?? 0;

  const sum = baseFee + distFare + extraStop + waitingFee;
  return sum > 0 ? sum : null;
}

export default function TripWalletPanel({ trip }: Props) {
  const fare = useMemo(() => computeFareFromBooking(trip), [trip]);
  const companyCut = useMemo(() => trip?.company_cut ?? null, [trip]);
  const driverPayout = useMemo(() => trip?.driver_payout ?? null, [trip]);

  // Wallet balances aren't on bookings in your schema; show if API provides computed fields.
  const driverWallet = useMemo(
    () => trip?.driver_wallet_balance ?? trip?.driver_wallet ?? trip?.driverWallet ?? null,
    [trip]
  );
  const vendorWallet = useMemo(
    () => trip?.vendor_wallet_balance ?? trip?.vendor_wallet ?? trip?.vendorWallet ?? null,
    [trip]
  );

  return (
    <div className="grid grid-cols-2 gap-2 text-[11px]">
      <div className="rounded border bg-white p-2">
        <div className="text-slate-500">Fare</div>
        <div className="font-semibold">{fmtMoney(fare)}</div>
      </div>

      <div className="rounded border bg-white p-2">
        <div className="text-slate-500">Company cut</div>
        <div className="font-semibold">{fmtMoney(companyCut)}</div>
      </div>

      <div className="rounded border bg-white p-2">
        <div className="text-slate-500">Driver payout</div>
        <div className="font-semibold">{fmtMoney(driverPayout)}</div>
      </div>

      <div className="rounded border bg-white p-2">
        <div className="text-slate-500">Driver wallet</div>
        <div className="font-semibold">{fmtMoney(driverWallet)}</div>
      </div>

      <div className="rounded border bg-white p-2 col-span-2">
        <div className="text-slate-500">Vendor wallet</div>
        <div className="font-semibold">{fmtMoney(vendorWallet)}</div>
      </div>
    </div>
  );
}
