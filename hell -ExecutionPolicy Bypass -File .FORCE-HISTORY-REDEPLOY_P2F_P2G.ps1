warning: in the working copy of 'app/history/page.tsx', CRLF will be replaced by LF the next time Git touches it
[1mdiff --git a/app/history/page.tsx b/app/history/page.tsx[m
[1mindex 33c5368..b53f1f9 100644[m
[1m--- a/app/history/page.tsx[m
[1m+++ b/app/history/page.tsx[m
[36m@@ -11,10 +11,11 @@[m [mtype TripSummary = {[m
   service: "Ride";[m
   pickup: string;[m
   dropoff: string;[m
[31m-  payment?: string; // now optional; hide card if missing[m
[32m+[m[32m  payment?: string; // optional; hide card if missing[m
   farePhp?: number;[m
   distanceKm?: number;[m
   status: TripStatus;[m
[32m+[m[32m  sortTs?: number; // for newest-first sorting[m
   _raw?: any;[m
 };[m
 [m
[36m@@ -43,6 +44,12 @@[m [mfunction peso(n?: number) {[m
   return "PHP " + n.toFixed(2);[m
 }[m
 [m
[32m+[m[32mfunction fareLabel(n?: number) {[m
[32m+[m[32m  if (typeof n !== "number" || !isFinite(n)) return EMPTY;[m
[32m+[m[32m  if (Math.abs(n) < 0.000001) return "Free ride";[m
[32m+[m[32m  return peso(n);[m
[32m+[m[32m}[m
[32m+[m
 function km(n?: number) {[m
   if (typeof n !== "number" || !isFinite(n)) return EMPTY;[m
   return n.toFixed(1) + " km";[m
[36m@@ -82,6 +89,14 @@[m [mfunction pickFirst(obj: any, keys: string[]): any {[m
   return undefined;[m
 }[m
 [m
[32m+[m[32mfunction parseTs(v: any): number | undefined {[m
[32m+[m[32m  const s = safeStr(v, "");[m
[32m+[m[32m  if (!s) return undefined;[m
[32m+[m[32m  const d = new Date(s);[m
[32m+[m[32m  const t = d.getTime();[m
[32m+[m[32m  return isFinite(t) ? t : undefined;[m
[32m+[m[32m}[m
[32m+[m
 function fmtDateLabel(v: any): string {[m
   const s = safeStr(v, "");[m
   const d = s ? new Date(s) : null;[m
[36m@@ -111,7 +126,7 @@[m [mfunction buildReceiptText(t: TripSummary) {[m
   lines.push("Dropoff: " + normalizeText(t.dropoff));[m
   lines.push("");[m
   if (typeof t.distanceKm === "number") lines.push("Distance: " + km(t.distanceKm));[m
[31m-  if (typeof t.farePhp === "number") lines.push("Fare: " + peso(t.farePhp));[m
[32m+[m[32m  if (typeof t.farePhp === "number") lines.push("Fare: " + fareLabel(t.farePhp));[m
   if (t.payment && normalizeText(t.payment) !== EMPTY) lines.push("Payment: " + normalizeText(t.payment));[m
   lines.push("");[m
   lines.push("Thank you for riding with JRide.");[m
[36m@@ -143,8 +158,73 @@[m [masync function copyToClipboard(text: string) {[m
   }[m
 }[m
 [m
[32m+[m[32mfunction downloadTextFile(filename: string, text: string) {[m
[32m+[m[32m  try {[m
[32m+[m[32m    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });[m
[32m+[m[32m    const url = URL.createObjectURL(blob);[m
[32m+[m[32m    const a = document.createElement("a");[m
[32m+[m[32m    a.href = url;[m
[32m+[m[32m    a.download = filename;[m
[32m+[m[32m    document.body.appendChild(a);[m
[32m+[m[32m    a.click();[m
[32m+[m[32m    a.remove();[m
[32m+[m[32m    URL.revokeObjectURL(url);[m
[32m+[m[32m    return true;[m
[32m+[m[32m  } catch {[m
[32m+[m[32m    return false;[m
[32m+[m[32m  }[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32mfunction printReceipt(title: string, text: string) {[m
[32m+[m[32m  try {[m
[32m+[m[32m    const w = window.open("", "_blank", "noopener,noreferrer");[m
[32m+[m[32m    if (!w) return false;[m
[32m+[m
[32m+[m[32m    const esc = (s: string) =>[m
[32m+[m[32m      s[m
[32m+[m[32m        .replace(/&/g, "&amp;")[m
[32m+[m[32m        .replace(/</g, "&lt;")[m
[32m+[m[32m        .replace(/>/g, "&gt;")[m
[32m+[m[32m        .replace(/"/g, "&quot;")[m
[32m+[m[32m        .replace(/'/g, "&#39;");[m
[32m+[m
[32m+[m[32m    const html = `<!doctype html>[m
[32m+[m[32m<html>[m
[32m+[m[32m<head>[m
[32m+[m[32m<meta charset="utf-8"/>[m
[32m+[m[32m<title>${esc(title)}</title>[m
[32m+[m[32m<style>[m
[32m+[m[32m  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; padding: 24px; }[m
[32m+[m[32m  .card { border: 1px solid #ddd; border-radius: 12px; padding: 18px; max-width: 720px; margin: 0 auto; }[m
[32m+[m[32m  h1 { font-size: 18px; margin: 0 0 8px; }[m
[32m+[m[32m  pre { white-space: pre-wrap; font-size: 13px; line-height: 1.4; margin: 0; }[m
[32m+[m[32m  .hint { opacity: 0.6; font-size: 12px; margin-top: 10px; }[m
[32m+[m[32m  @media print { .hint { display: none; } body { padding: 0; } .card { border: none; } }[m
[32m+[m[32m</style>[m
[32m+[m[32m</head>[m
[32m+[m[32m<body>[m
[32m+[m[32m  <div class="card">[m
[32m+[m[32m    <h1>${esc(title)}</h1>[m
[32m+[m[32m    <pre>${esc(text)}</pre>[m
[32m+[m[32m    <div class="hint">Print dialog should open automatically.</div>[m
[32m+[m[32m  </div>[m
[32m+[m[32m  <script>[m
[32m+[m[32m    window.focus();[m
[32m+[m[32m    window.print();[m
[32m+[m[32m  </script>[m
[32m+[m[32m</body>[m
[32m+[m[32m</html>`;[m
[32m+[m
[32m+[m[32m    w.document.open();[m
[32m+[m[32m    w.document.write(html);[m
[32m+[m[32m    w.document.close();[m
[32m+[m[32m    return true;[m
[32m+[m[32m  } catch {[m
[32m+[m[32m    return false;[m
[32m+[m[32m  }[m
[32m+[m[32m}[m
[32m+[m
 function computeFareFromComponents(r: any): number | undefined {[m
[31m-  // Only compute if at least one component exists.[m
   const base = safeNum(pickFirst(r, ["base_fee"])) ?? 0;[m
   const dist = safeNum(pickFirst(r, ["distance_fare"])) ?? 0;[m
   const extraStop = safeNum(pickFirst(r, ["extra_stop_fee"])) ?? 0;[m
[36m@@ -166,7 +246,6 @@[m [mfunction computeFareFromComponents(r: any): number | undefined {[m
 }[m
 [m
 function computePayment(r: any): string | undefined {[m
[31m-  // If errand_cash_mode exists and is truthy, show Cash[m
   const cashMode = pickFirst(r, ["errand_cash_mode"]);[m
   if (cashMode === true || cashMode === "true" || cashMode === 1 || cashMode === "1") return "Cash";[m
 [m
[36m@@ -198,11 +277,6 @@[m [mfunction normalizeTrips(payload: any): TripSummary[] {[m
       EMPTY[m
     );[m
 [m
[31m-    // Fare priority:[m
[31m-    // 1) verified_fare[m
[31m-    // 2) passenger_fare_response[m
[31m-    // 3) proposed_fare[m
[31m-    // 4) computed components[m
     const farePhp =[m
       safeNum(pickFirst(r, ["verified_fare"])) ??[m
       safeNum(pickFirst(r, ["passenger_fare_response"])) ??[m
[36m@@ -210,16 +284,21 @@[m [mfunction normalizeTrips(payload: any): TripSummary[] {[m
       safeNum(pickFirst(r, ["fare", "total_fare", "total"])) ??[m
       computeFareFromComponents(r);[m
 [m
[31m-    // Distance: show only if distance_km exists[m
     const distanceKm = safeNum(pickFirst(r, ["distance_km", "distanceKm"]));[m
 [m
     const status = safeStr(pickFirst(r, ["status", "ride_status", "state"]), "pending");[m
[31m-[m
     const payment = computePayment(r);[m
 [m
     const created = pickFirst(r, ["created_at", "requested_at", "started_at", "completed_at", "updated_at"]);[m
     const dateLabel = fmtDateLabel(created);[m
 [m
[32m+[m[32m    const sortTs =[m
[32m+[m[32m      parseTs(pickFirst(r, ["updated_at"])) ??[m
[32m+[m[32m      parseTs(pickFirst(r, ["completed_at"])) ??[m
[32m+[m[32m      parseTs(pickFirst(r, ["created_at"])) ??[m
[32m+[m[32m      parseTs(created) ??[m
[32m+[m[32m      0;[m
[32m+[m
     return {[m
       ref: normalizeText(ref),[m
       dateLabel: normalizeText(dateLabel),[m
[36m@@ -230,6 +309,7 @@[m [mfunction normalizeTrips(payload: any): TripSummary[] {[m
       farePhp,[m
       distanceKm,[m
       status: normalizeText(status),[m
[32m+[m[32m      sortTs,[m
       _raw: r,[m
     };[m
   });[m
[36m@@ -255,6 +335,7 @@[m [mexport default function HistoryPage() {[m
   const [selectedRef, setSelectedRef] = useState<string>("");[m
 [m
   const [toast, setToast] = useState<string>("");[m
[32m+[m[32m  const [q, setQ] = useState<string>("");[m
 [m
   useEffect(() => {[m
     let alive = true;[m
[36m@@ -296,10 +377,22 @@[m [mexport default function HistoryPag