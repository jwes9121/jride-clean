"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

type AvailabilityResponse = {
  success: boolean;
  event?: {
    name: string;
    shortName: string;
    slug: string;
    status: string;
    registrationOpensAt: string | null;
    registrationClosesAt: string | null;
  };
  total?: number;
  remaining?: number;
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

function cleanPhone(value: string) {
  return value.replace(/[^0-9]/g, "");
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

  const router = useRouter();

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

  const [remaining, setRemaining] =
    React.useState(0);

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

        setRegistrationOpensAt(
          data.event?.registrationOpensAt || null
        );

        setRegistrationClosesAt(
          data.event?.registrationClosesAt || null
        );

        setTotal(data.total || 0);
        setRemaining(data.remaining || 0);
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

      router.push(destination);
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

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <section className="mx-auto max-w-lg">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            JRide Events
          </p>

          <h1 className="mt-4 text-4xl font-black leading-tight">
            {eventName}
          </h1>

          <p className="mt-3 text-slate-300">
            Enter the ticket number and private
            claim code issued after payment.
          </p>

          <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950 p-4">
            {loading ? (
              <p className="text-sm font-semibold text-slate-300">
                Loading ticket availability...
              </p>
            ) : availabilityError ? (
              <p className="text-sm font-semibold text-red-300">
                {availabilityError}
              </p>
            ) : soldOut ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-300">
                  Sold Out
                </p>
                <p className="mt-2 text-2xl font-black">
                  No regular tickets remain.
                </p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
                  Tickets Remaining
                </p>

                <p className="mt-2 text-3xl font-black">
                  {remaining}
                  <span className="text-lg text-slate-400">
                    {" "}
                    / {total}
                  </span>
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
                    placeholder="FR-001"
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
                    placeholder="XXXX-XXXX-XXXX"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-4 font-mono text-white outline-none focus:border-amber-300"
                  />
                </label>

                <p className="mt-3 text-xs leading-5 text-slate-400">
                  The claim code is handwritten on
                  the back of the paid ticket or
                  sent privately by the authorized
                  seller. It can only be used once.
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
                        event.target.value
                      );
                      setFormError("");
                    }}
                    placeholder="09171234567"
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
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
                  ? "Completing Registration..."
                  : "Complete Registration"}
              </button>
            </fieldset>
          </form>
        </div>
      </section>
    </main>
  );
}