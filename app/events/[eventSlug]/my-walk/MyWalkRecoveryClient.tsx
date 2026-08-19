"use client";

import * as React from "react";

type Props = {
  eventSlug: string;
};

type GroupValuesResponse = {
  success: boolean;
  eventName?: string;
  eventShortName?: string;
};

type AccountRecoveryResponse = {
  success: boolean;
  eventPassUrl?: string;
  resultCode?: string;
  message?: string;
};

function passengerToken() {
  try {
    return String(
      window.localStorage.getItem(
        "jride_passenger_token"
      ) ||
        window.localStorage.getItem(
          "jride_access_token"
        ) ||
        ""
    ).trim();
  } catch {
    return "";
  }
}

export default function MyWalkRecoveryClient({
  eventSlug,
}: Props) {
  const [eventName, setEventName] =
    React.useState("");
  const [pageMessage, setPageMessage] =
    React.useState("");
  const [pageMessageTone, setPageMessageTone] =
    React.useState<"error" | "warning" | "info">(
      "info"
    );
  const [hasPassengerSession, setHasPassengerSession] =
    React.useState(false);
  const [accountLoading, setAccountLoading] =
    React.useState(false);
  const [accountMessage, setAccountMessage] =
    React.useState("");

  React.useEffect(() => {
    setHasPassengerSession(
      Boolean(passengerToken())
    );

    try {
      const result =
        new URLSearchParams(
          window.location.search
        ).get("recovery") || "";

      if (result === "rate_limited") {
        setPageMessageTone("warning");
        setPageMessage(
          "Too many recovery attempts were made. Wait 10 minutes before trying again, or proceed to the event Help Desk."
        );
      } else if (result === "failed") {
        setPageMessageTone("error");
        setPageMessage(
          "The submitted details could not be verified. Check the ticket number, private claim code, and registered mobile number, or proceed to the event Help Desk."
        );
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    if (!eventSlug) return;

    let active = true;

    async function loadEvent() {
      try {
        const response = await fetch(
          `/api/events/${encodeURIComponent(
            eventSlug
          )}/group-values`,
          {
            cache: "no-store",
          }
        );

        const payload =
          (await response.json()) as GroupValuesResponse;

        if (
          !active ||
          !response.ok ||
          !payload.success
        ) {
          return;
        }

        setEventName(
          payload.eventName ||
            payload.eventShortName ||
            ""
        );
      } catch {}
    }

    void loadEvent();

    return () => {
      active = false;
    };
  }, [eventSlug]);

  async function openWithJrideAccount() {
    const token = passengerToken();

    if (!token) {
      window.location.href =
        `/passenger-login?callbackUrl=${encodeURIComponent(
          `/events/${eventSlug}/my-walk`
        )}`;
      return;
    }

    setAccountLoading(true);
    setAccountMessage("");

    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(
          eventSlug
        )}/my-walk/account`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const payload =
        (await response.json()) as AccountRecoveryResponse;

      if (
        !response.ok ||
        !payload.success ||
        !payload.eventPassUrl
      ) {
        if (response.status === 401) {
          throw new Error(
            "Your JRide session has expired. Sign in again, then return to this page."
          );
        }

        throw new Error(
          payload.message ||
            "No Event Pass is linked to this JRide account. Use ticket recovery or proceed to the event Help Desk."
        );
      }

      window.location.assign(
        payload.eventPassUrl
      );
    } catch (caught) {
      setAccountMessage(
        caught instanceof Error
          ? caught.message
          : "Unable to recover the Event Pass with this JRide account."
      );
    } finally {
      setAccountLoading(false);
    }
  }

  const messageClass =
    pageMessageTone === "error"
      ? "border-red-300 bg-red-100 text-red-800"
      : pageMessageTone === "warning"
      ? "border-amber-300 bg-amber-100 text-amber-900"
      : "border-slate-300 bg-slate-100 text-slate-800";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <section className="mx-auto max-w-3xl">
        <div className="rounded-3xl border border-cyan-300/40 bg-slate-900 p-6 shadow-2xl sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
            JRide Events
          </p>
          <h1 className="mt-3 text-4xl font-black leading-tight">
            Find My Event Pass and My Live Walk
          </h1>
          <p className="mt-3 text-lg font-bold text-slate-200">
            {eventName || "Fun Walk Event"}
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
            This page opens your existing private Event Pass. It does not create a second registration, a second B2FR number, or another tracking record.
          </p>

          {pageMessage ? (
            <div
              className={`mt-5 rounded-2xl border p-4 text-sm font-bold ${messageClass}`}
            >
              {pageMessage}
            </div>
          ) : null}
        </div>

        <div className="mt-5 rounded-3xl border border-amber-300/40 bg-slate-900 p-6 shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
            Issued Regular or Sponsor Ticket
          </p>
          <h2 className="mt-2 text-2xl font-black">
            Recover with your private ticket details
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Use this option only for an FR or SP ticket that was already registered online.
          </p>

          <form
            method="post"
            action={`/api/events/${encodeURIComponent(
              eventSlug
            )}/my-walk/recover`}
            className="mt-5 space-y-4"
          >
            <label className="block">
              <span className="text-sm font-bold text-slate-200">
                Ticket Number
              </span>
              <input
                name="ticketNumber"
                required
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="Regular: 344 or FR-344 | Sponsor: SP-005"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 uppercase text-white outline-none focus:border-amber-300"
              />
              <span className="mt-2 block text-xs leading-5 text-slate-400">
                A bare number means a regular FR ticket. Sponsor tickets must include the SP prefix.
              </span>
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-200">
                Private Claim Code
              </span>
              <input
                name="claimCode"
                required
                minLength={8}
                maxLength={64}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="Code printed on the issued ticket"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 uppercase text-white outline-none focus:border-amber-300"
              />
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-200">
                Registered Mobile Number
              </span>
              <input
                name="mobileNumber"
                required
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="09XXXXXXXXX"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
              />
            </label>

            <button
              type="submit"
              className="w-full rounded-2xl bg-amber-400 px-5 py-4 text-lg font-black text-slate-950"
            >
              Verify and Open My Event Pass
            </button>
          </form>

          <p className="mt-4 text-xs leading-5 text-slate-500">
            For security, failed recovery responses do not reveal whether a ticket, mobile number, or registration exists.
          </p>
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-blue-400/40 bg-slate-900 p-6">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">
              JRide Account
            </p>
            <h2 className="mt-2 text-2xl font-black">
              Open a linked Event Pass
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              This works only when the event registration is already linked to the same JRide passenger account.
            </p>

            <button
              type="button"
              onClick={() =>
                void openWithJrideAccount()
              }
              disabled={accountLoading}
              className="mt-5 w-full rounded-2xl bg-blue-600 px-5 py-4 font-black text-white disabled:opacity-60"
            >
              {accountLoading
                ? "Checking JRide Account..."
                : hasPassengerSession
                ? "Open Linked Event Pass"
                : "Sign In to JRide"}
            </button>

            {accountMessage ? (
              <p className="mt-3 rounded-xl bg-red-100 px-3 py-2 text-sm font-bold text-red-800">
                {accountMessage}
              </p>
            ) : null}
          </div>

          <div className="rounded-3xl border border-emerald-400/40 bg-slate-900 p-6">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">
              Batch 2001 / Golden Jubilarian
            </p>
            <h2 className="mt-2 text-2xl font-black">
              Help Desk recovery
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Do not use a public name-only or B2FR-only search. If the registration has no private ticket claim code and is not linked to JRide, proceed to the event Help Desk for identity verification and reissue of the existing Event Pass.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              SMS OTP recovery is not connected for this event yet. JRide will not pretend that B2FR plus a mobile number is equivalent to a private security code.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-3xl border border-slate-700 bg-slate-900 p-6">
          <h2 className="text-xl font-black">
            What the Help Desk will do
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Staff will search the existing attendee record, verify the person using available event records and identification, then reissue the same Event Pass. Staff must not create a duplicate registration merely because the participant lost the link.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={`/events/${eventSlug}`}
              className="rounded-xl border border-slate-600 px-5 py-3 text-sm font-black text-slate-200"
            >
              Event Details
            </a>
            <a
              href={`/events/${eventSlug}/course`}
              className="rounded-xl border border-cyan-600 px-5 py-3 text-sm font-black text-cyan-200"
            >
              Official Course
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}