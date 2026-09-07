"use client";

import { useState } from "react";
import { Leaf } from "lucide-react";

export function ProductPhoto({ url, name, className = "" }: { url?: string; name: string; className?: string }) {
  const [failed, setFailed] = useState("");
  const usable = url && /^https?:\/\//.test(url) && failed !== url;
  return <div className={`relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#edf1e3] ${className}`}>
    {usable ? <img src={url} alt={name} loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(url)} /> : <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 text-[#687d55]"><Leaf size={32} strokeWidth={1.3} aria-hidden="true" /><span className="text-xs">No product photo yet</span></div>}
  </div>;
}
