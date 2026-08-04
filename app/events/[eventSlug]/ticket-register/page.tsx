import { redirect } from "next/navigation";

// Temporary redirect: /events/[eventSlug]/register now supports primary +
// guests, requires a ticket + claim code for every person, and preserves
// the Batch 2001 / Golden Jubilarian links - making it the stronger
// canonical public entry point. This old single-person ticket-register
// page is retired from normal use but not deleted outright, so existing
// bookmarks, printed links, and QR references still resolve correctly.
//
// Only the PAGE is redirected here. The backing API route
// (app/api/events/[eventSlug]/ticket-register/route.ts) and the
// claim_event_ticket_and_register RPC are deliberately left untouched -
// unknown whether any external integration, printed material, or
// historical reference still calls the API directly. Do not remove
// either until a repo-wide search for "/ticket-register",
// "/api/events/.../ticket-register", and "claim_event_ticket_and_register"
// confirms nothing still depends on them.
export default function TicketRegisterRedirectPage({
  params,
}: {
  params: {
    eventSlug: string;
  };
}) {
  redirect(`/events/${params.eventSlug}/register`);
}
