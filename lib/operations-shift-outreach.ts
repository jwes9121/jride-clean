export const OUTCOMES = {
  no_answer: "No answer", will_go_online: "Will go online", unavailable_today: "Unavailable today",
  needs_help: "Needs assistance", reminded: "Reminder delivered",
} as const;
export const CHANNELS = { call: "Phone call", message: "Message", in_person: "In person" } as const;
export const SIGNALS: Record<string, string> = {
  offline: "Reported offline", stale: "Status stale - check availability", not_recorded: "No status recorded",
  unknown: "Availability needs checking", online: "Online", on_trip: "On a trip",
};
export type OutreachOutcome = keyof typeof OUTCOMES;
export type Contact = {
  request_id: string; driver_id: string; driver_name: string; town: string; actor_id: string;
  channel: keyof typeof CHANNELS; outcome: OutreachOutcome; note: string; recorded_at: string;
  online_after_contact_at: string | null;
};
export type Candidate = {
  driver_id: string; name: string; phone: string | null; town: string; signal: string;
  last_seen_at: string | null; needs_wallet_help: boolean;
  last_contact: Pick<Contact, "request_id" | "outcome" | "note" | "actor_id" | "recorded_at"> | null;
};
export type Outreach = { live: boolean; server_time: string; candidates: Candidate[]; contacts: Contact[]; basis: string };
export function outreachStats(contacts: Contact[]) {
  return {
    attempts: contacts.length,
    contacted: new Set(contacts.map(c => c.driver_id)).size,
    laterOnline: new Set(contacts.filter(c => c.online_after_contact_at).map(c => c.driver_id)).size,
  };
}
export function contactPhone(value: string | null) {
  const clean = (value || "").replace(/[\s()-]/g, "");
  return /^\+?[0-9]{7,15}$/.test(clean) ? `tel:${clean}` : null;
}
