"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import Image from "next/image";

type GroupValuesResponse = {
  success: boolean;
  eventName?: string;
  eventShortName?: string;
};

type GuestForm = {
  fullName: string;
  relationship: string;
  mobileNumber: string;
  ticketNumber: string;
  claimCode: string;
};

type PersonResult = {
  attendeeId: string;
  registrationNumber: string;
  qrToken: string;
  relationship?: string;
  eventPassUrl?: string;
};

type RegistrationResponse = {
  success: boolean;
  attendeeId?: string;
  registrationNumber?: string;
  qrToken?: string;
  eventPassUrl?: string;
  message?: string;
  participationRecorded?: boolean;
  specialRegistrationNotApplied?: boolean;
  ticket?: {
    ticketNumber: string | null;
    packageName: string | null;
    price: number | string | null;
  } | null;
  guests?: PersonResult[];
  resultCode?: string;
};

const relationships = ["Spouse", "Partner", "Child", "Relative", "Friend", "Other"];
const MAX_GUESTS = 3;

function cleanPhone(value: string) {
  const digits = value.replace(/[^0-9]/g, "");

  if (/^09[0-9]{9}$/.test(digits)) return digits;
  if (/^639[0-9]{9}$/.test(digits)) return "0" + digits.slice(2);
  if (/^9[0-9]{9}$/.test(digits)) return "0" + digits;

  return "";
}

export default function EventRegistrationPage() {
  const params = useParams<{ eventSlug: string }>();
  const eventSlug = String(params?.eventSlug || "");

  const [eventName, setEventName] = React.useState("");

  const [fullName, setFullName] = React.useState("");
  const [mobileNumber, setMobileNumber] = React.useState("");
  const [nickname, setNickname] = React.useState("");
  const [ticketNumber, setTicketNumber] = React.useState("");
  const [claimCode, setClaimCode] = React.useState("");
  const [guests, setGuests] = React.useState<GuestForm[]>([]);

  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState("");
  const [specialNotice, setSpecialNotice] = React.useState<RegistrationResponse | null>(null);
  const [registrationResult, setRegistrationResult] = React.useState<RegistrationResponse | null>(null);

  React.useEffect(() => {
    let active = true;

    async function loadEventName() {
      try {
        const res = await fetch(`/api/events/${eventSlug}/group-values`, {
          cache: "no-store",
        });

        const data = (await res.json()) as GroupValuesResponse;

        if (!res.ok || !data.success) return;
        if (!active) return;

        setEventName(data.eventName || data.eventShortName || "");
      } catch {
        // eventName is decorative only (falls back to "Event Registration"
        // in the render below) - a failed fetch here must not block
        // registration.
      }
    }

    if (eventSlug) loadEventName();

    return () => {
      active = false;
    };
  }, [eventSlug]);

  function addGuest() {
    if (guests.length >= MAX_GUESTS) return;
    setGuests((prev) => [
      ...prev,
      {
        fullName: "",
        relationship: "Spouse",
        mobileNumber: "",
        ticketNumber: "",
        claimCode: "",
      },
    ]);
  }

  function updateGuest(index: number, patch: Partial<GuestForm>) {
    setGuests((prev) =>
      prev.map((guest, i) => (i === index ? { ...guest, ...patch } : guest))
    );
  }

  function removeGuest(index: number) {
    setGuests((prev) => prev.filter((_, i) => i !== index));
  }

  function validateLocal() {
    if (fullName.trim().length < 2) return "Full name is required.";
    if (cleanPhone(mobileNumber).length < 10) return "Valid mobile number is required.";

    if (!ticketNumber.trim() || claimCode.trim().length < 8) {
      return "Ticket Number and Private Claim Code are required.";
    }

    for (let i = 0; i < guests.length; i++) {
      const guest = guests[i];

      if (guest.fullName.trim().length < 2) {
        return `Guest ${i + 1} name is required.`;
      }

      if (!guest.relationship.trim()) {
        return `Guest ${i + 1} relationship is required.`;
      }

      if (guest.mobileNumber.trim().length > 0 && cleanPhone(guest.mobileNumber).length < 10) {
        return `Guest ${i + 1}: mobile number must be 10 digits, or left blank.`;
      }

      if (!guest.ticketNumber.trim() || guest.claimCode.trim().length < 8) {
        return `Guest ${i + 1}: Ticket Number and Private Claim Code are required.`;
      }
    }

    return "";
  }

  async function submitRegistration() {
    const localError = validateLocal();

    if (localError) {
      setFormError(localError);
      return;
    }

    setSubmitting(true);
    setFormError("");

    try {
      const res = await fetch(`/api/events/${eventSlug}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          mobileNumber: cleanPhone(mobileNumber),
          nickname: nickname.trim() || undefined,
          ticketNumber: ticketNumber.trim().toUpperCase(),
          claimCode: claimCode.trim().toUpperCase(),
          guests: guests.map((guest) => ({
            fullName: guest.fullName.trim(),
            relationship: guest.relationship,
            mobileNumber: cleanPhone(guest.mobileNumber) || undefined,
            ticketNumber: guest.ticketNumber.trim().toUpperCase(),
            claimCode: guest.claimCode.trim().toUpperCase(),
          })),
        }),
      });

      const data = (await res.json()) as RegistrationResponse;

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Registration failed.");
      }

      if (data.specialRegistrationNotApplied) {
        setSpecialNotice(data);
        return;
      }

      if (!data.registrationNumber || !data.qrToken) {
        throw new Error("Registration succeeded but Event Pass details are missing.");
      }

      // No auto-redirect: guests now each have their own independent
      // Event Pass (their own QR), not a shared one with the primary -
      // jumping straight to the primary's pass would leave the person to
      // backtrack for their guests' passes.
      setRegistrationResult(data);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Registration failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (specialNotice) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <section className="mx-auto max-w-md rounded-3xl border border-amber-300/40 bg-slate-900 p-6 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            Already Registered
          </p>
          <h1 className="mt-4 text-3xl font-black">
            Your registration details were not saved.
          </h1>
          <p className="mt-4 text-slate-300">
            {specialNotice.message ||
              "This mobile number already has an Event Pass. Please visit Event Registration and Assistance so your registration details can be updated."}
          </p>

          {specialNotice.eventPassUrl ? (
            <a
              href={specialNotice.eventPassUrl}
              className="mt-6 block rounded-2xl bg-amber-400 px-5 py-4 text-center font-bold text-slate-950"
            >
              View Your Event Pass
            </a>
          ) : null}

          <a
            href={`/events/${eventSlug}/register`}
            className="mt-3 block rounded-2xl border border-slate-600 px-5 py-4 text-center font-bold text-white"
          >
            Back to Registration
          </a>
        </section>
      </main>
    );
  }

  if (registrationResult) {
    const guestResults = registrationResult.guests || [];

    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <section className="mx-auto max-w-md rounded-3xl border border-amber-300/40 bg-slate-900 p-6 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            Registration Complete
          </p>
          <h1 className="mt-4 text-3xl font-black">
            {guestResults.length > 0
              ? "Your Event Passes are ready."
              : "Your Event Pass is ready."}
          </h1>
          <p className="mt-4 text-slate-300">
            {guestResults.length > 0
              ? "Each person has their own independent QR - view or save each pass below."
              : "View or save your Event Pass below."}
          </p>

          <div className="mt-6 space-y-3">
            {registrationResult.eventPassUrl ? (
              <a
                href={registrationResult.eventPassUrl}
                className="block rounded-2xl bg-amber-400 px-5 py-4 text-center font-bold text-slate-950"
              >
                {fullName.trim() || "Your"} Event Pass
              </a>
            ) : null}

            {guestResults.map((guest, index) => (
              <a
                key={guest.attendeeId}
                href={guest.eventPassUrl}
                className="block rounded-2xl border border-amber-300/60 px-5 py-4 text-center font-bold text-white"
              >
                {guest.relationship || `Guest ${index + 1}`} Event Pass
              </a>
            ))}
          </div>

          <a
            href={`/events/${eventSlug}/register`}
            className="mt-6 block rounded-2xl border border-slate-600 px-5 py-4 text-center font-bold text-white"
          >
            Register Another Group
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <section className="mx-auto max-w-md">
        <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl">
          <a
            href="/events/platform"
            className="block relative aspect-[4/3] w-full bg-slate-950"
          >
            <Image
              src="/events/b2001-fun-run-logo.png"
              alt="Batch 2001 Fun Run with Zumba"
              fill
              priority
              sizes="(max-width: 640px) 100vw, 448px"
              className="object-contain"
            />
          </a>

          <div className="px-6 pt-4 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
              Powered by JRide Events
            </p>
            <a
              href="/events/platform"
              className="mt-2 inline-block text-sm font-bold text-amber-300 hover:underline"
            >
              See how this platform works {"->"}
            </a>
          </div>

          <div className="p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
              JRide Events
            </p>
            <h1 className="mt-4 text-4xl font-black leading-tight">
              {eventName || "Event Registration"}
            </h1>
            <p className="mt-3 text-slate-300">
              Register now and receive your Event Pass QR. A valid ticket
              number and private claim code are required for every person
            joining the Fun Walk &amp; Taebo.
          </p>

          <div className="mt-6 rounded-2xl bg-slate-950 p-4 text-sm text-slate-300">
            Already have JRide?{" "}
            <a href="/passenger-login" className="font-bold text-amber-300">
              Sign in
            </a>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950 p-4">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
              Special Registration Groups
            </p>

            <div className="mt-3 space-y-2">
              <a
                href={`/events/${eventSlug}/register/batch-2001`}
                className="block rounded-xl border border-amber-300/40 bg-slate-900 px-4 py-3"
              >
                <p className="font-bold text-white">
                  Register as Batch 2001 Member
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  For official Batch 2001 attendees and their companions.
                </p>
              </a>

              <a
                href={`/events/${eventSlug}/register/golden-jubilarian`}
                className="block rounded-xl border border-amber-300/40 bg-slate-900 px-4 py-3"
              >
                <p className="font-bold text-white">
                  Register as Golden Jubilarian
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  For Golden Jubilarians and their companions.
                </p>
              </a>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              All other participants may use the registration form below.
            </p>
          </div>

          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitRegistration();
            }}
          >
            <label className="block">
              <span className="text-sm font-bold text-slate-200">Full Name *</span>
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
                placeholder="Juan Dela Cruz"
                autoComplete="name"
              />
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-200">Mobile Number *</span>
              <input
                value={mobileNumber}
                onChange={(event) => setMobileNumber(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
                placeholder="09171234567 or +639171234567"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
              />
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-200">Nickname (optional)</span>
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
                placeholder="Optional"
              />
            </label>

            <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4">
              <p className="font-black text-white">Need tickets?</p>
              <p className="mt-1 text-sm leading-6 text-slate-300">
                Contact our Finance Team at{" "}
                <a
                  href="tel:+639753585757"
                  className="font-black text-amber-300 underline decoration-amber-300/40 underline-offset-4"
                >
                  0975 358 5757
                </a>
                {" "}for ticket assistance.
              </p>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <a
                  href="tel:+639753585757"
                  className="rounded-xl bg-amber-400 px-4 py-3 text-center text-sm font-black text-slate-950"
                >
                  Call Finance
                </a>
                <a
                  href="sms:+639753585757"
                  className="rounded-xl border border-amber-300/50 bg-slate-950 px-4 py-3 text-center text-sm font-black text-amber-300"
                >
                  Text Finance
                </a>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-300/40 bg-slate-950 p-4">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                Ticket Details
              </p>

              <label className="mt-3 block">
                <span className="text-sm font-bold text-slate-200">Ticket Number *</span>
                <input
                  value={ticketNumber}
                  onChange={(event) => setTicketNumber(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 uppercase text-white outline-none focus:border-amber-300"
                  placeholder="Regular: 344 | Sponsor: SP-033"
                  autoCapitalize="characters"
                />
              </label>

              <label className="mt-3 block">
                <span className="text-sm font-bold text-slate-200">
                  Private Claim Code *
                </span>
                <input
                  value={claimCode}
                  onChange={(event) => setClaimCode(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 uppercase text-white outline-none focus:border-amber-300"
                  placeholder="Found on your ticket"
                  autoCapitalize="characters"
                />
              </label>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-950 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-bold">Guests (optional)</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Add up to {MAX_GUESTS} guests online, each with their own
                    ticket. Extra guests can be added at the Help Desk.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addGuest}
                  disabled={guests.length >= MAX_GUESTS}
                  className="shrink-0 rounded-xl bg-amber-400 px-3 py-2 text-sm font-bold text-slate-950 disabled:opacity-50"
                >
                  Add
                </button>
              </div>

              {guests.length > 0 ? (
                <div className="mt-4 space-y-4">
                  {guests.map((guest, index) => (
                    <div key={index} className="rounded-2xl border border-slate-700 p-4">
                      <div className="flex items-center justify-between">
                        <p className="font-bold">Guest {index + 1}</p>
                        <button
                          type="button"
                          onClick={() => removeGuest(index)}
                          className="text-sm font-bold text-red-300"
                        >
                          Remove
                        </button>
                      </div>

                      <input
                        value={guest.fullName}
                        onChange={(event) =>
                          updateGuest(index, { fullName: event.target.value })
                        }
                        className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none focus:border-amber-300"
                        placeholder="Guest full name"
                      />

                      <select
                        value={guest.relationship}
                        onChange={(event) =>
                          updateGuest(index, { relationship: event.target.value })
                        }
                        className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none focus:border-amber-300"
                      >
                        {relationships.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>

                      <label className="mt-3 block">
                        <span className="text-sm font-bold text-slate-200">
                          Guest Mobile Number (optional)
                        </span>
                        <input
                          value={guest.mobileNumber}
                          onChange={(event) =>
                            updateGuest(index, { mobileNumber: event.target.value })
                          }
                          className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none focus:border-amber-300"
                          placeholder="Optional"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                        />
                      </label>

                      <label className="mt-3 block">
                        <span className="text-sm font-bold text-slate-200">
                          Guest Ticket Number *
                        </span>
                        <input
                          value={guest.ticketNumber}
                          onChange={(event) =>
                            updateGuest(index, { ticketNumber: event.target.value })
                          }
                          className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 uppercase text-white outline-none focus:border-amber-300"
                          placeholder="Regular: 344 | Sponsor: SP-033"
                          autoCapitalize="characters"
                        />
                      </label>

                      <label className="mt-3 block">
                        <span className="text-sm font-bold text-slate-200">
                          Guest Private Claim Code *
                        </span>
                        <input
                          value={guest.claimCode}
                          onChange={(event) =>
                            updateGuest(index, { claimCode: event.target.value })
                          }
                          className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 uppercase text-white outline-none focus:border-amber-300"
                          placeholder="Found on their ticket"
                          autoCapitalize="characters"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {formError ? (
              <p className="rounded-2xl bg-red-100 px-4 py-3 text-sm font-semibold text-red-800">
                {formError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-amber-400 px-5 py-4 text-lg font-black text-slate-950 disabled:opacity-60"
            >
              {submitting ? "Registering..." : "Register"}
            </button>
          </form>
          </div>
        </div>
      </section>
    </main>
  );
}
