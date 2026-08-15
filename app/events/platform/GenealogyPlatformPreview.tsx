"use client";

import * as React from "react";
import Image from "next/image";

type Props = {
  label: string;
  imageSrc: string;
};

const MIN_ZOOM = 75;
const MAX_ZOOM = 250;
const ZOOM_STEP = 25;
const DEFAULT_ZOOM = 125;

export default function GenealogyPlatformPreview({
  label,
  imageSrc,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [zoom, setZoom] = React.useState(DEFAULT_ZOOM);

  React.useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setZoom(DEFAULT_ZOOM);
  }

  function changeZoom(delta: number) {
    setZoom((current) =>
      Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, current + delta)
      )
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-cyan-300/30 bg-slate-950 text-left transition hover:border-cyan-300"
        aria-label={`Enlarge ${label} preview`}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-red-400" />
          <span className="h-2 w-2 rounded-full bg-amber-300" />
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Platform preview
          </span>
          <span className="ml-auto rounded-full border border-cyan-300/30 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-cyan-300 transition group-hover:bg-cyan-300 group-hover:text-slate-950">
            Click to zoom
          </span>
        </div>

        <div className="relative aspect-[4/3] w-full bg-slate-950">
          <Image
            src={imageSrc}
            alt={`${label} preview`}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-contain object-center"
          />
        </div>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[200] bg-black/90 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${label} enlarged preview`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              close();
            }
          }}
        >
          <div className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-950 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-300">
                  Family Reunion & Genealogy
                </p>
                <p className="mt-1 text-sm font-bold text-white">
                  Expanding five-generation showcase
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => changeZoom(-ZOOM_STEP)}
                  disabled={zoom <= MIN_ZOOM}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-black text-white disabled:opacity-40"
                  aria-label="Zoom out"
                >
                  -
                </button>

                <span className="min-w-[62px] text-center text-sm font-black text-white">
                  {zoom}%
                </span>

                <button
                  type="button"
                  onClick={() => changeZoom(ZOOM_STEP)}
                  disabled={zoom >= MAX_ZOOM}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-black text-white disabled:opacity-40"
                  aria-label="Zoom in"
                >
                  +
                </button>

                <button
                  type="button"
                  onClick={() => setZoom(DEFAULT_ZOOM)}
                  className="rounded-lg border border-cyan-300/40 px-3 py-2 text-xs font-black text-cyan-200"
                >
                  Reset
                </button>

                <a
                  href="/events/ifugao-family-reunion-showcase/family-tree"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-black text-slate-950"
                >
                  Open Live Demo
                </a>

                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border border-red-700 px-3 py-2 text-xs font-black text-red-200"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-950 p-4">
              <div
                className="relative mx-auto min-w-full"
                style={{
                  width: `${zoom}%`,
                  aspectRatio: "1352 / 795",
                }}
              >
                <Image
                  src={imageSrc}
                  alt={`${label} enlarged preview`}
                  fill
                  priority
                  sizes="250vw"
                  className="object-contain object-center"
                />
              </div>
            </div>

            <div className="border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
              Use the zoom controls above, then scroll horizontally or vertically to inspect individual family branches. Press Escape to close.
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
