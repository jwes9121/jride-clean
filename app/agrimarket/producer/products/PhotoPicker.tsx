"use client";

import { useId, useRef, useState } from "react";
import { Camera } from "lucide-react";

// Resize phone photos before upload so they fit the hosting request limit.
async function preparePhoto(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP photo.");
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("Choose a photo under 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("Choose a photo no larger than 40 megapixels.");
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the photo.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.8));
    if (!blob || blob.size > 3 * 1024 * 1024) throw new Error("Choose a smaller photo.");
    return new File([blob], "product-photo.webp", { type: blob.type });
  } finally { URL.revokeObjectURL(url); }
}

export function PhotoPicker({ label, disabled, onSelect, onBusy }: { label: string; disabled?: boolean; onSelect: (file: File) => Promise<void> | void; onBusy?: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const errorId = useId();
  return <div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label={label} disabled={disabled || working} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      setWorking(true); setError(""); onBusy?.(true);
      try { await onSelect(await preparePhoto(file)); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "The photo could not be prepared. Please try another photo."); }
      finally { setWorking(false); onBusy?.(false); }
    }} />
    <button type="button" disabled={disabled || working} aria-describedby={error ? errorId : undefined} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#d8dfcc] bg-white px-4 py-3 text-sm font-semibold text-[#153c30] disabled:opacity-50" onClick={() => input.current?.click()}><Camera size={17} aria-hidden="true" />{working ? "Preparing photo…" : label}</button>
    {error && <p role="alert" id={errorId} className="mt-2 text-sm text-red-800">{error}</p>}
  </div>;
}
