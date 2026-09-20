"use client";

import { useEffect, useRef } from "react";

export default function OrderExpiryDialog({ orderCode, storeName, title, message, onAcknowledge }: {
  orderCode: string; storeName?: string | null; title: string; message: string; onAcknowledge: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} role="alertdialog" aria-labelledby="order-expired-heading"
    aria-describedby="order-expired-message" onCancel={event => event.preventDefault()}
    className="w-[calc(100%_-_1.5rem)] max-w-md rounded-2xl border-2 border-red-500 p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60">
    <div className="flex max-h-[85dvh] flex-col">
      <div className="overflow-y-auto bg-red-50 p-5">
        <h2 id="order-expired-heading" className="text-2xl font-bold text-red-800">{title}</h2>
        <p className="mt-3 text-sm font-semibold">{orderCode}</p>
        {storeName && <p className="mt-1 text-sm">Store: <strong>{storeName}</strong></p>}
        <p id="order-expired-message" className="mt-4">{message}</p>
        <p className="mt-3 text-sm">This booking is closed. You can place a new order from AgriMarket.</p>
      </div>
      <div className="shrink-0 border-t bg-white p-4">
        <button type="button" autoFocus onClick={onAcknowledge}
          className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">OK - Back to AgriMarket</button>
      </div>
    </div>
  </dialog>;
}
