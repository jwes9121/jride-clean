"use client";

import Image from "next/image";
import * as React from "react";
import { useParams } from "next/navigation";

type AvailabilityResponse = {
  success: boolean;
  event?: {
    name: string;
    shortName: string;
    slug: string;
    status: string;
    eventDate: string | null;
    venue: string | null;
    registrationOpensAt: string | null;
    registrationClosesAt: string | null;
  };
  total?: number;
  available?: number;
  reserved?: number;
  claimed?: number;
  registrationSlotsRemaining?: number;
  soldOut?: boolean;
  error?: string;
};

type TicketRegistrationResponse = {
  success: boolean;
  resultCode?: string;
  message?: string;
  attendeeId?: string;
  registrationNumber?: string;
  qrToken?: string;
  eventPassUrl?: string;
  ticket?: {
    ticketId: string | null;
    ticketNumber: string | null;
    packageName: string | null;
    price: number | null;
  };
};

type SuccessState = {
  registrationNumber: string;
  eventPassUrl: string;
  ticketNumber: string | null;
  packageName: string | null;
};

function cleanPhone(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function formatPhoneInput(value: string) {
  const digits = cleanPhone(value).slice(0, 11);

  if (digits.length <= 4) return digits;
  if (digits.length <= 7) {
    return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  }

  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}

function formatManilaDate(
  value: string | null | undefined
) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function messageForResult(
  resultCode: string,
  serverMessage: string,
  registrationOpensAt: string | null,
  registrationClosesAt: string | null
) {
  switch (resultCode) {
    case "INVALID_TICKET":
      return "Ticket details could not be validated. Check the ticket number and claim code.";

    case "EVENT_NOT_OPEN":
      return "Registration is not open yet.";

    case "REGISTRATION_NOT_STARTED": {
      const date = formatManilaDate(
        registrationOpensAt
      );

      return date
        ? `Registration opens on ${date}.`
        : "Registration has not opened yet.";
    }

    case "REGISTRATION_CLOSED": {
      const date = formatManilaDate(
        registrationClosesAt
      );

      return date
        ? `Registration closed on ${date}.`
        : "Registration is already closed.";
    }

    case "RATE_LIMITED":
      return "Too many unsuccessful attempts. Please wait 10 minutes before trying again.";

    case "TICKET_UNAVAILABLE":
      return "This ticket has already been used or is no longer available.";

    case "DUPLICATE_MOBILE":
      return "This mobile number is already registered for this event.";

    case "INVALID_NAME":
      return "Full name is required.";

    case "INVALID_MOBILE_NUMBER":
      return "A valid mobile number is required.";

    case "INVALID_REQUEST":
      return "Ticket number and claim code are required.";

    default:
      return (
        serverMessage ||
        "Registration failed. Please try again."
      );
  }
}

export default function TicketRegistrationPage() {
  const params =
    useParams<{ eventSlug: string }>();

  const eventSlug = String(
    params?.eventSlug || ""
  );

  const submittingRef =
    React.useRef(false);

  const [loading, setLoading] =
    React.useState(true);

  const [availabilityError, setAvailabilityError] =
    React.useState("");

  const [eventName, setEventName] =
    React.useState("Ticketed Event");

  const [eventDate, setEventDate] =
    React.useState<string | null>(null);

  const [venue, setVenue] =
    React.useState<string | null>(null);

  const [
    registrationOpensAt,
    setRegistrationOpensAt,
  ] = React.useState<string | null>(null);

  const [
    registrationClosesAt,
    setRegistrationClosesAt,
  ] = React.useState<string | null>(null);

  const [total, setTotal] =
    React.useState(0);

  const [claimed, setClaimed] =
    React.useState(0);

  const [
    registrationSlotsRemaining,
    setRegistrationSlotsRemaining,
  ] = React.useState(0);

  const [soldOut, setSoldOut] =
    React.useState(false);

  const [ticketNumber, setTicketNumber] =
    React.useState("");

  const [claimCode, setClaimCode] =
    React.useState("");

  const [fullName, setFullName] =
    React.useState("");

  const [mobileNumber, setMobileNumber] =
    React.useState("");

  const [nickname, setNickname] =
    React.useState("");

  const [submitting, setSubmitting] =
    React.useState(false);

  const [formError, setFormError] =
    React.useState("");

  const [success, setSuccess] =
    React.useState<SuccessState | null>(null);

  React.useEffect(() => {
    let active = true;

    async function loadAvailability() {
      setLoading(true);
      setAvailabilityError("");

      try {
        const response = await fetch(
          `/api/events/${eventSlug}/ticket-availability`,
          {
            cache: "no-store",
          }
        );

        const data =
          (await response.json()) as AvailabilityResponse;

        if (!response.ok || !data.success) {
          throw new Error(
            data.error ||
              "Ticket availability failed to load."
          );
        }

        if (!active) return;

        setEventName(
          data.event?.name ||
            data.event?.shortName ||
            "Ticketed Event"
        );

        setEventDate(
          data.event?.eventDate || null
        );

        setVenue(
          data.event?.venue || null
        );

        setRegistrationOpensAt(
          data.event?.registrationOpensAt || null
        );

        setRegistrationClosesAt(
          data.event?.registrationClosesAt || null
        );

        setTotal(data.total || 0);
        setClaimed(data.claimed || 0);

        setRegistrationSlotsRemaining(
          data.registrationSlotsRemaining || 0
        );

        setSoldOut(data.soldOut === true);
      } catch (error) {
        if (!active) return;

        setAvailabilityError(
          error instanceof Error
            ? error.message
            : "Ticket availability failed to load."
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    if (eventSlug) {
      void loadAvailability();
    }

    return () => {
      active = false;
      submittingRef.current = false;
    };
  }, [eventSlug]);

  function validateLocal() {
    if (!ticketNumber.trim()) {
      return "Ticket number is required.";
    }

    if (!claimCode.trim()) {
      return "Claim code is required.";
    }

    if (fullName.trim().length < 2) {
      return "Full name is required.";
    }

    const phone = cleanPhone(
      mobileNumber
    );

    if (
      phone.length < 10 ||
      phone.length > 15
    ) {
      return "A valid mobile number is required.";
    }

    return "";
  }

  async function submitRegistration() {
    if (submittingRef.current) {
      return;
    }

    const localError = validateLocal();

    if (localError) {
      setFormError(localError);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFormError("");

    try {
      const response = await fetch(
        `/api/events/${eventSlug}/ticket-register`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            ticketNumber:
              ticketNumber.trim().toUpperCase(),
            claimCode:
              claimCode.trim().toUpperCase(),
            fullName: fullName.trim(),
            mobileNumber:
              cleanPhone(mobileNumber),
            nickname:
              nickname.trim() || undefined,
          }),
        }
      );

      const data =
        (await response.json()) as TicketRegistrationResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          messageForResult(
            data.resultCode || "",
            data.message || "",
            registrationOpensAt,
            registrationClosesAt
          )
        );
      }

      if (
        !data.registrationNumber ||
        !data.qrToken
      ) {
        throw new Error(
          "Registration succeeded but Event Pass details are missing."
        );
      }

      const destination =
        data.eventPassUrl ||
        `/events/${eventSlug}/pass/${encodeURIComponent(
          data.registrationNumber
        )}?token=${encodeURIComponent(
          data.qrToken
        )}`;

      setClaimed((current) => current + 1);
      setRegistrationSlotsRemaining(
        (current) => Math.max(0, current - 1)
      );

      setSuccess({
        registrationNumber:
          data.registrationNumber,
        eventPassUrl: destination,
        ticketNumber:
          data.ticket?.ticketNumber || null,
        packageName:
          data.ticket?.packageName || null,
      });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Registration failed."
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <section className="mx-auto max-w-lg">
          <div className="rounded-3xl border border-emerald-400/40 bg-slate-900 p-6 shadow-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-emerald-300">
              Registration Successful
            </p>

            <h1 className="mt-4 text-4xl font-black leading-tight">
              Your Event Pass is ready.
            </h1>

            <p className="mt-3 text-slate-300">
              Save your Event Pass and present its QR code at check-in.
            </p>

            <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                Registration Number
              </p>
              <p className="mt-2 font-mono text-2xl font-black text-white">
                {success.registrationNumber}
              </p>

              {success.ticketNumber ? (
                <>
                  <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                    Ticket Number
                  </p>
                  <p className="mt-2 font-mono text-lg font-bold text-amber-300">
                    {success.ticketNumber}
                  </p>
                </>
              ) : null}

              {success.packageName ? (
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  {success.packageName}
                </p>
              ) : null}
            </div>

            <a
              href={success.eventPassUrl}
              className="mt-6 block w-full rounded-2xl bg-amber-400 px-5 py-4 text-center text-lg font-black text-slate-950"
            >
              View My Event Pass
            </a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <section className="mx-auto max-w-lg">
        <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl">
          <div className="relative aspect-[4/3] w-full bg-slate-950">
            <Image
              src="/events/b2001-fun-run-logo.png"
              alt="Batch 2001 Fun Run with Zumba"
              fill
              priority
              sizes="(max-width: 640px) 100vw, 512px"
              className="object-contain"
            />
          </div>

          <div className="p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
              JRide Events
            </p>

            <h1 className="mt-4 text-4xl font-black leading-tight">
              {eventName}
            </h1>

            <p className="mt-3 text-slate-300">
              Thank you for supporting the Batch 2001 fundraising event.
            </p>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              Enter the ticket number and private claim code written on the back of your paid ticket or sent by the authorized seller after payment confirmation.
            </p>

            {(eventDate || venue) ? (
              <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-300">
                {eventDate ? (
                  <p>
                    <span className="font-bold text-white">
                      Date:
                    </span>{" "}
                    {formatManilaDate(eventDate)}
                  </p>
                ) : null}

                {venue ? (
                  <p className={eventDate ? "mt-2" : ""}>
                    <span className="font-bold text-white">
                      Venue:
                    </span>{" "}
                    {venue}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950 p-4">
              {loading ? (
                <p className="text-sm font-semibold text-slate-300">
                  Loading registration status...
                </p>
              ) : availabilityError ? (
                <p className="text-sm font-semibold text-red-300">
                  {availabilityError}
                </p>
              ) : soldOut ? (
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-300">
                    Registration Full
                  </p>
                  <p className="mt-2 text-2xl font-black">
                    All regular ticket codes have been claimed.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
                    Event Passes Generated
                  </p>

                  <p className="mt-2 text-3xl font-black">
                    {claimed}
                    <span className="text-lg text-slate-400">
                      {" "}
                      / {total}
                    </span>
                  </p>

                  <p className="mt-2 text-sm text-slate-400">
                    {registrationSlotsRemaining} valid ticket registrations remain.
                  </p>
                </div>
              )}
            </div>

            <form
              className="mt-6 space-y-6"
              onSubmit={(event) => {
                event.preventDefault();
                void submitRegistration();
              }}
            >
              <fieldset
                disabled={
                  submitting ||
                  loading ||
                  !!availabilityError ||
                  soldOut
                }
                className="space-y-6 disabled:opacity-60"
              >
                <section className="rounded-2xl border border-slate-700 bg-slate-950 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
                    1. Ticket Details
                  </p>

                  <label className="mt-4 block">
                    <span className="text-sm font-bold text-slate-200">
                      Ticket Number *
                    </span>

                    <input
                      value={ticketNumber}
                      onChange={(event) => {
                        setTicketNumber(
                          event.target.value
                        );
                        setFormError("");
                      }}
                      placeholder="Example: FR-001"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-4 font-mono text-white outline-none focus:border-amber-300"
                    />
                  </label>

                  <label className="mt-4 block">
                    <span className="text-sm font-bold text-slate-200">
                      Private Claim Code *
                    </span>

                    <input
                      value={claimCode}
                      onChange={(event) => {
                        setClaimCode(
                          event.target.value
                        );
                        setFormError("");
                      }}
                      placeholder="Example: A1B2-C3D4-E5F6"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-4 font-mono text-white outline-none focus:border-amber-300"
                    />
                  </label>

                  <p className="mt-3 text-xs leading-5 text-slate-400">
                    The claim code is issued only after payment confirmation and can be used once.
                  </p>
                </section>

                <section className="rounded-2xl border border-slate-700 bg-slate-950 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
                    2. Participant Information
                  </p>

                  <label className="mt-4 block">
                    <span className="text-sm font-bold text-slate-200">
                      Full Name *
                    </span>

                    <input
                      value={fullName}
                      onChange={(event) => {
                        setFullName(
                          event.target.value
                        );
                        setFormError("");
                      }}
                      placeholder="Juan Dela Cruz"
                      autoComplete="name"
                      className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-4 text-white outline-none focus:border-amber-300"
                    />
                  </label>

                  <label className="mt-4 block">
                    <span className="text-sm font-bold text-slate-200">
                      Mobile Number *
                    </span>

                    <input
                      value={mobileNumber}
                      onChange={(event) => {
                        setMobileNumber(
                          formatPhoneInput(
                            event.target.value
                          )
                        );
                        setFormError("");
                      }}
                      placeholder="0917 123 4567"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-4 text-white outline-none focus:border-amber-300"
                    />
                  </label>

                  <label className="mt-4 block">
                    <span className="text-sm font-bold text-slate-200">
                      Nickname (optional)
                    </span>

                    <input
                      value={nickname}
                      onChange={(event) => {
                        setNickname(
                          event.target.value
                        );
                        setFormError("");
                      }}
                      placeholder="Optional"
                      autoComplete="nickname"
                      className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-4 text-white outline-none focus:border-amber-300"
                    />
                  </label>
                </section>

                {formError ? (
                  <p className="rounded-2xl bg-red-100 px-4 py-3 text-sm font-semibold text-red-800">
                    {formError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-2xl bg-amber-400 px-5 py-4 text-lg font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting
                    ? "Generating Event Pass..."
                    : "Generate My Event Pass"}
                </button>
              </fieldset>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
