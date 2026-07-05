import QRCode from "qrcode";

export async function renderQrDataUrl(value: string): Promise<string> {
  const text = String(value || "").trim();

  if (!text) {
    throw new Error("QR value is required.");
  }

  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 4,
    scale: 8,
    type: "image/png",
  });
}