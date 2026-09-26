"use client";

import { useId, useRef, useState } from "react";
import { Camera } from "lucide-react";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 40_000_000;
const TARGET_UPLOAD_BYTES = 700 * 1024;
const HARD_UPLOAD_BYTES = 1024 * 1024;
const DIMENSION_STEPS = [1600, 1400, 1200, 1000, 900];
const QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58, 0.5];

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

// Phone photos are reduced before upload. The server still re-validates and
// re-encodes the image, so client compression is an optimization, not trust.
export async function preparePhoto(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG or WebP photo.");
  }
  if (!file.size || file.size > MAX_SOURCE_BYTES) {
    throw new Error("Choose a photo under 20 MB.");
  }

  let bitmap: ImageBitmap | null = null;
  let objectUrl = "";
  let source: CanvasImageSource | null = null;
  let sourceWidth = 0;
  let sourceHeight = 0;

  try {
    if ("createImageBitmap" in window) {
      try {
        bitmap = await createImageBitmap(file);
        source = bitmap;
        sourceWidth = bitmap.width;
        sourceHeight = bitmap.height;
      } catch {
        bitmap = null;
      }
    }

    if (!bitmap) {
      objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      source = image;
      sourceWidth = image.naturalWidth;
      sourceHeight = image.naturalHeight;
    }

    if (
      !source ||
      !sourceWidth ||
      !sourceHeight ||
      !Number.isFinite(sourceWidth) ||
      !Number.isFinite(sourceHeight) ||
      sourceWidth * sourceHeight > MAX_SOURCE_PIXELS
    ) {
      throw new Error("Choose a photo no larger than 40 megapixels.");
    }

    let smallest: Blob | null = null;

    for (const maxSide of DIMENSION_STEPS) {
      const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("This device could not prepare the photo.");

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);

      for (const quality of QUALITY_STEPS) {
        let blob = await canvasBlob(canvas, "image/webp", quality);
        if (!blob || blob.type !== "image/webp") {
          blob = await canvasBlob(canvas, "image/jpeg", quality);
        }
        if (!blob) continue;
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= TARGET_UPLOAD_BYTES) {
          const extension = blob.type === "image/webp" ? "webp" : "jpg";
          return new File([blob], `product-photo.${extension}`, { type: blob.type });
        }
      }
    }

    if (!smallest || smallest.size > HARD_UPLOAD_BYTES) {
      throw new Error("This photo is too detailed to upload safely. Try another photo.");
    }

    const extension = smallest.type === "image/webp" ? "webp" : "jpg";
    return new File([smallest], `product-photo.${extension}`, { type: smallest.type });
  } finally {
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export function PhotoPicker({ label, disabled, onSelect, onBusy }: {
  label: string;
  disabled?: boolean;
  onSelect: (file: File) => Promise<void> | void;
  onBusy?: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const errorId = useId();

  return <div>
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      hidden
      aria-label={label}
      disabled={disabled || working}
      onChange={async event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setWorking(true);
        setError("");
        onBusy?.(true);
        try {
          await onSelect(await preparePhoto(file));
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "The photo could not be prepared. Please try another photo.");
        } finally {
          setWorking(false);
          onBusy?.(false);
        }
      }}
    />
    <button
      type="button"
      disabled={disabled || working}
      aria-describedby={error ? errorId : undefined}
      className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#d8dfcc] bg-white px-4 py-3 text-sm font-semibold text-[#153c30] disabled:opacity-50"
      onClick={() => input.current?.click()}
    >
      <Camera size={17} aria-hidden="true" />{working ? "Optimizing photo..." : label}
    </button>
    {working && <p className="mt-2 text-xs text-slate-600">JRide is resizing and compressing the photo before upload.</p>}
    {error && <p role="alert" id={errorId} className="mt-2 text-sm text-red-800">{error}</p>}
  </div>;
}
