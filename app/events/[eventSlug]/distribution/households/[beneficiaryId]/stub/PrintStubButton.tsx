"use client";

export default function PrintStubButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-2xl bg-slate-950 px-6 py-3 font-black text-white"
    >
      Print Claim Stub
    </button>
  );
}
