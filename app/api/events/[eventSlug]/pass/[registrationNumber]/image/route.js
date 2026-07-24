import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// app/api/events/[eventSlug]/pass/[registrationNumber]/image/route.ts
//
// Server-side Event Pass PNG generation.
// Design matches the HTML Event Pass page exactly.
//
// GET /api/events/[slug]/pass/[registrationNumber]/image?token=...
//
// Sections (matching page.tsx order):
//   1. Header gradient -- "Welcome Home." / event name / branding
//   2. EVENT PASS label
//   3. Status badge (Registered / Checked In / Invalid)
//   4. Avatar with initials (same palette as HTML)
//   5. Name, nickname, group
//   6. Pass number box
//   7. QR code
//   8. Online registration instruction (when applicable -- same condition as HTML)
//   9. Guests & Family (if any)
//  10. Footer
import { NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import QRCode from "qrcode";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://app.jride.net").replace(/\/$/, "");
// Image dimensions
const W = 600;
// ---- Helpers (mirrors page.tsx exactly) ----
function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0)
        return "JP";
    if (parts.length === 1)
        return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
// Avatar gradient -- same palette and hash as page.tsx avatarClass()
function avatarGradient(name) {
    const palette = [
        "linear-gradient(135deg,#b91c1c,#ef4444)",
        "linear-gradient(135deg,#b45309,#f59e0b)",
        "linear-gradient(135deg,#1d4ed8,#3b82f6)",
        "linear-gradient(135deg,#047857,#10b981)",
        "linear-gradient(135deg,#6d28d9,#8b5cf6)",
        "linear-gradient(135deg,#334155,#64748b)",
    ];
    let hash = 0;
    for (const char of String(name || ""))
        hash += char.charCodeAt(0);
    return palette[hash % palette.length];
}
function statusBadge(attendee) {
    if (attendee.is_disqualified) {
        return {
            label: "Invalid",
            detail: attendee.disqualification_reason || "Please proceed to the Help Desk.",
            bg: "#fee2e2",
            border: "#fca5a5",
            color: "#991b1b",
            dot: "#dc2626",
        };
    }
    if (attendee.attendance_status === "checked_in") {
        const time = attendee.checked_in_at
            ? new Intl.DateTimeFormat("en-PH", {
                timeZone: "Asia/Manila",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
            }).format(new Date(attendee.checked_in_at))
            : "";
        return {
            label: "Checked In",
            detail: time,
            bg: "#d1fae5",
            border: "#6ee7b7",
            color: "#065f46",
            dot: "#059669",
        };
    }
    return {
        label: "Registered",
        detail: "Not yet checked in",
        bg: "#d1fae5",
        border: "#6ee7b7",
        color: "#065f46",
        dot: "#059669",
    };
}
function formatDate(value) {
    if (!value)
        return "Date to be announced";
    return new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
}
// ---- Route ----
export async function GET(req, { params }) {
    try {
        const { eventSlug, registrationNumber } = params;
        const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
        if (!eventSlug || !registrationNumber || !token) {
            return new NextResponse("Missing parameters.", { status: 400 });
        }
        const supabase = supabaseAdmin();
        // Load event (same query as page.tsx)
        const { data: event, error: eventError } = await supabase
            .from("events")
            .select("id,slug,name,short_name,event_date,venue,group_label")
            .eq("slug", eventSlug)
            .in("status", [
                "published",
                "registration_open",
                "registration_closed",
                "live",
                "completed",
            ])
            .maybeSingle();
        if (eventError || !event?.id) {
            return new NextResponse("Event not found.", { status: 404 });
        }
        // Load attendee and validate token (same query as page.tsx)
        const { data: attendee, error: attendeeError } = await supabase
            .from("event_attendees")
            .select("id,full_name,nickname,group_value,registration_number,qr_token,attendance_status,checked_in_at,is_disqualified,disqualification_reason,registration_source")
            .eq("event_id", event.id)
            .eq("registration_number", decodeURIComponent(registrationNumber))
            .eq("qr_token", token)
            .is("merged_into", null)
            .maybeSingle();
        if (attendeeError || !attendee?.id) {
            return new NextResponse("Attendee not found.", { status: 404 });
        }
        // Load guests (same as page.tsx)
        const { data: guestRows } = await supabase
            .from("event_guest_links")
            .select("relationship,guest:event_attendees!event_guest_links_guest_attendee_id_fkey(id,full_name,registration_number,attendance_status)")
            .eq("event_id", event.id)
            .eq("primary_attendee_id", attendee.id)
            .order("created_at", { ascending: true });
        const guests = (guestRows || [])
            .map((row) => {
            const g = Array.isArray(row.guest) ? row.guest[0] : row.guest;
            if (!g)
                return null;
            return { name: g.full_name, registrationNumber: g.registration_number, relationship: row.relationship };
        })
            .filter(Boolean);
        // Compute values -- same conditions as page.tsx
        const groupLabel = event.group_label || "Group";
        const status = statusBadge(attendee);
        // Same condition as page.tsx showOnlineInstruction
        const showOnlineInstruction = attendee.registration_source === "online" &&
            attendee.attendance_status !== "checked_in";
        // Build pass URL and generate QR (server-side -- no CORS, no tainted canvas)
        const passUrl = `${APP_URL}/events/${encodeURIComponent(event.slug)}/pass/${encodeURIComponent(attendee.registration_number)}?token=${encodeURIComponent(attendee.qr_token)}`;
        const qrDataUrl = await QRCode.toDataURL(passUrl, {
            errorCorrectionLevel: "M",
            margin: 2,
            scale: 8,
            color: { dark: "#000000", light: "#ffffff" },
        });
        const avatarGrad = avatarGradient(attendee.full_name);
        const abbr = initials(attendee.full_name);
        const imageHeight = 1040 +
            (showOnlineInstruction ? 150 : 0) +
            (guests.length > 0 ? 100 + guests.length * 58 : 0);
        // ---- JSX layout matching page.tsx design ----
        const passElement = (_jsxs("div", { style: {
                width: W,
                height: imageHeight,
                background: "#ffffff",
                display: "flex",
                flexDirection: "column",
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
                borderRadius: 32,
                overflow: "hidden",
                border: "1px solid #1e293b",
                boxShadow: "0 25px 50px rgba(0,0,0,0.4)",
            }, children: [_jsxs("div", { style: {
                        background: "linear-gradient(135deg,#450a0a 0%,#020617 50%,#78350f 100%)",
                        padding: "28px 40px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        textAlign: "center",
                    }, children: [_jsx("span", { style: { color: "#fde68a", fontSize: 12, fontWeight: 600, letterSpacing: 4 }, children: "Welcome Home." }), _jsx("span", { style: { color: "#ffffff", fontSize: 22, fontWeight: 800, marginTop: 10, lineHeight: 1.25 }, children: event.name }), _jsx("span", { style: { color: "#94a3b8", fontSize: 11, letterSpacing: 4, marginTop: 10, textTransform: "uppercase" }, children: "Digital Event Platform" }), _jsx("span", { style: { color: "#94a3b8", fontSize: 13, marginTop: 4 }, children: "Powered by JRide Corporation" })] }), _jsxs("div", { style: { padding: "24px 40px 32px", display: "flex", flexDirection: "column", alignItems: "center" }, children: [_jsx("span", { style: { fontSize: 10, fontWeight: 800, letterSpacing: 5, color: "#64748b", textTransform: "uppercase" }, children: "Event Pass" }), _jsxs("div", { style: {
                                marginTop: 16,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                background: status.bg,
                                border: `1px solid ${status.border}`,
                                borderRadius: 9999,
                                padding: "8px 16px",
                            }, children: [_jsx("div", { style: { width: 10, height: 10, borderRadius: "50%", background: status.dot } }), _jsx("span", { style: { fontSize: 13, fontWeight: 700, color: status.color }, children: status.label }), status.detail ? (_jsxs("span", { style: { fontSize: 13, color: status.color, opacity: 0.8 }, children: ["- ", status.detail] })) : null] }), _jsx("div", { style: {
                                marginTop: 28,
                                width: 80,
                                height: 80,
                                borderRadius: "50%",
                                background: avatarGrad,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                            }, children: _jsx("span", { style: { color: "#ffffff", fontSize: 28, fontWeight: 900 }, children: abbr }) }), _jsx("span", { style: { marginTop: 20, fontSize: 32, fontWeight: 900, color: "#0f172a", lineHeight: 1.1, textAlign: "center" }, children: attendee.full_name }), attendee.nickname ? (_jsx("span", { style: { marginTop: 4, fontSize: 14, fontWeight: 600, color: "#64748b" }, children: `"${attendee.nickname}"` })) : null, _jsxs("span", { style: { marginTop: 12, fontSize: 18, fontWeight: 700, color: "#334155" }, children: [groupLabel, " ", attendee.group_value] }), _jsxs("div", { style: {
                                marginTop: 20,
                                background: "#f1f5f9",
                                borderRadius: 16,
                                padding: "16px 28px",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                            }, children: [_jsx("span", { style: { fontSize: 10, fontWeight: 800, letterSpacing: 4, color: "#64748b", textTransform: "uppercase" }, children: "Pass No." }), _jsx("span", { style: { marginTop: 8, fontSize: 26, fontWeight: 900, color: "#0f172a", letterSpacing: 1, fontFamily: "monospace, ui-monospace, Courier New" }, children: attendee.registration_number })] }), _jsx("div", { style: {
                                marginTop: 28,
                                width: 240,
                                height: 240,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "#ffffff",
                                borderRadius: 24,
                                border: "1px solid #e2e8f0",
                                padding: 16,
                                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                            }, children: _jsx("img", { src: qrDataUrl, width: 200, height: 200, alt: "QR", style: { display: "block" } }) }), showOnlineInstruction ? (_jsxs("div", { style: {
                                marginTop: 20,
                                background: "#ecfdf5",
                                border: "1px solid #6ee7b7",
                                borderRadius: 16,
                                padding: 20,
                                display: "flex",
                                flexDirection: "column",
                                width: "100%",
                            }, children: [_jsx("span", { style: { fontSize: 10, fontWeight: 800, letterSpacing: 3, color: "#047857", textTransform: "uppercase" }, children: "Online Registration Complete" }), _jsx("span", { style: { marginTop: 10, fontSize: 13, fontWeight: 600, color: "#334155", lineHeight: 1.6 }, children: "Thank you for registering online. Please present this Event Pass at the entrance for faster admission and to skip the registration queue." })] })) : null, guests.length > 0 ? (_jsxs("div", { style: {
                                marginTop: 20,
                                background: "#f8fafc",
                                border: "1px solid #e2e8f0",
                                borderRadius: 16,
                                padding: 20,
                                display: "flex",
                                flexDirection: "column",
                                width: "100%",
                            }, children: [_jsx("span", { style: { fontSize: 10, fontWeight: 800, letterSpacing: 3, color: "#64748b", textTransform: "uppercase" }, children: "Guests & Family" }), guests.map((g, idx) => (_jsxs("div", { style: { marginTop: 12, display: "flex", alignItems: "center", gap: 10 }, children: [_jsx("div", { style: { width: 20, height: 20, borderRadius: "50%", background: "#d1fae5", display: "flex", alignItems: "center", justifyContent: "center" }, children: _jsx("span", { style: { fontSize: 9, fontWeight: 900, color: "#047857" }, children: "G" }) }), _jsxs("div", { style: { display: "flex", flexDirection: "column" }, children: [_jsx("span", { style: { fontSize: 14, fontWeight: 700, color: "#0f172a" }, children: g.name }), _jsxs("span", { style: { fontSize: 12, color: "#64748b" }, children: [g.relationship, " - ", g.registrationNumber] })] })] }, idx)))] })) : null, _jsx("span", { style: { marginTop: 28, fontSize: 11, fontWeight: 600, letterSpacing: 3, color: "#94a3b8", textTransform: "uppercase" }, children: "Verified by JRide Events" })] })] }));
        const imageResponse = new ImageResponse(passElement, {
            width: W,
            height: imageHeight,
        });
        // Correct headers for reliable PNG download across all browsers and Android
        const headers = new Headers(imageResponse.headers);
        headers.set("Content-Type", "image/png");
        headers.set("Content-Disposition", `attachment; filename="${attendee.registration_number}.png"`);
        headers.set("Cache-Control", "no-store");
        return new NextResponse(imageResponse.body, { status: 200, headers });
    }
    catch (error) {
        console.error("[pass/image]", error);
        return new NextResponse("Image generation failed.", { status: 500 });
    }
}
