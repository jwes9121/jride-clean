"use client";

import * as React from "react";

type EventPassActionsProps = {
  cardId: string;
  filename: string;
};

function inlineComputedStyles(source: Element, target: Element) {
  const sourceNodes = [source, ...Array.from(source.querySelectorAll("*"))];
  const targetNodes = [target, ...Array.from(target.querySelectorAll("*"))];

  sourceNodes.forEach((sourceNode, index) => {
    const targetNode = targetNodes[index] as HTMLElement | undefined;
    if (!targetNode) return;

    const computed = window.getComputedStyle(sourceNode);
    const cssText = Array.from(computed)
      .map((property) => `${property}:${computed.getPropertyValue(property)};`)
      .join("");

    targetNode.setAttribute("style", cssText);
  });
}

async function createPng(element: HTMLElement): Promise<Blob> {
  const clone = element.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(".pass-capture-exclude")
    .forEach((node) => node.remove());

  inlineComputedStyles(element, clone);

  const width = Math.ceil(element.getBoundingClientRect().width);
  const height = Math.ceil(clone.scrollHeight || element.scrollHeight);
  const scale = 2;

  clone.style.width = `${width}px`;
  clone.style.height = "auto";
  clone.style.margin = "0";
  clone.style.borderRadius = "0";
  clone.style.boxShadow = "none";
  clone.style.background = "#ffffff";

  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${serialized}</div></foreignObject></svg>`;
  const svgUrl = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
  );

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () =>
        reject(new Error("The Event Pass image could not be generated."));
      nextImage.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("This browser cannot create the Event Pass image.");
    }

    context.scale(scale, scale);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("The Event Pass image could not be saved.")),
        "image/png",
        1
      );
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export default function EventPassActions({
  cardId,
  filename,
}: EventPassActionsProps) {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  async function saveToPhotos() {
    const card = document.getElementById(cardId);

    if (!card) {
      setError("Event Pass card was not found.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const blob = await createPng(card);
      const file = new File([blob], filename, { type: "image/png" });
      const shareNavigator = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };

      if (
        typeof navigator.share === "function" &&
        typeof shareNavigator.canShare === "function" &&
        shareNavigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: "JRide Event Pass",
          text: "Save this Event Pass to Photos for quick access at the entrance.",
        });
        return;
      }

      const downloadUrl = URL.createObjectURL(blob);

      try {
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(downloadUrl);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;

      setError(
        caught instanceof Error
          ? caught.message
          : "The Event Pass could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pass-capture-exclude no-print mt-7">
      <div className="grid gap-3">
        <button
          type="button"
          onClick={saveToPhotos}
          disabled={saving}
          className="rounded-2xl bg-slate-950 px-5 py-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Preparing Photo..." : "Save to Photos"}
        </button>

        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-2xl border border-slate-300 px-5 py-4 text-base font-bold text-slate-950"
        >
          Print Event Pass
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-2xl bg-red-100 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </p>
      ) : null}

      <p className="mt-3 text-center text-xs font-semibold text-slate-500">
        On supported phones, choose Save Image or Photos from the share sheet.
      </p>
    </div>
  );
}
