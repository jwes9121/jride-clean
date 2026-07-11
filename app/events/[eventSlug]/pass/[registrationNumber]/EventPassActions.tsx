"use client";

type EventPassActionsProps = {
  imageUrl: string;
};

export default function EventPassActions({
  imageUrl,
}: EventPassActionsProps) {
  function downloadPass() {
    window.location.href = imageUrl;
  }

  return (
    <div className="pass-capture-exclude no-print mt-7">
      <div className="grid gap-3">
        <button
          type="button"
          onClick={downloadPass}
          className="rounded-2xl bg-slate-950 px-5 py-4 text-base font-bold text-white"
        >
          Download Event Pass
        </button>

        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-2xl border border-slate-300 px-5 py-4 text-base font-bold text-slate-950"
        >
          Print Event Pass
        </button>
      </div>

      <p className="mt-3 text-center text-xs font-semibold text-slate-500">
        The Event Pass will be downloaded as a PNG image.
      </p>
    </div>
  );
}
