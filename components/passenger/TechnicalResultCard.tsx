"use client";

import React from "react";

type Props = {
  result: string;
  friendlyError: string;
};

export default function TechnicalResultCard({ result, friendlyError }: Props) {
  if (!result) return null;

  return (
    <div className="mt-4 rounded-xl border border-black/10 bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">Result</div>
        <div className="text-[11px] text-slate-400">Technical booking summary</div>
      </div>

      {friendlyError ? (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs">
          {friendlyError}
        </div>
      ) : null}

      <div className="mt-2 font-mono text-xs whitespace-pre-wrap">{result}</div>
    </div>
  );
}