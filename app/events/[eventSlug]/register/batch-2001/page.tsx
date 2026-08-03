"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

const MAX_COMPANIONS = 3;
const relationships = ["Spouse", "Partner", "Child", "Relative", "Friend", "Other"];

type CompanionForm = {
  fullName: string;
  relationship: string;
  joinFunWalk: boolean | null;
  attendLunch: boolean | null;
};

type GroupValuesResponse = {
  success: boolean;
  eventName?: string;
  eventShortName?: string;
};

type RegistrationResponse = {
  success: boolean;
  attendeeId?: string;
  registrationNumber?: string;
  qrToken?: string;
  eventPassUrl?: string;
  existingRegistration?: boolean;
  existingName?: string;
  message?: string;
  participationRecorded?: boolean;
  specialRegistrationNotApplied?: boolean;
  error?: {
    code: string;
    message: string;
  };
  identityResolution?: {
    isDuplicate: boolean;
    confidence: "high" | "medium" | "low";
    matchedAttendeeId?: string;
    registrationNumber?: string | null;
    matchReasons: string[];
    requiresReview: boolean;
  };
};

function cleanPhone(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function YesNo({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-3">
      <button
        type="button"
        onClick={() => onChange(true)}
        aria-pressed={value === true}
        className={`rounded-xl border px-4 py-3 font-bold transition ${
          value === true
            ? "border-amber-300 bg-amber-400 text-slate-950"
            : "border-slate-700 bg-slate-950 text-white"
        }`}
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        aria-pressed={value === false}
        className={`rounded-xl border px-4 py-3 font-bold transition ${
          value === false
            ? "border-amber-300 bg-amber-400 text-slate-950"
            : "border-slate-700 bg-slate-950 text-white"
        }`}
      >
        No
      </button>
    </div>
  );
}

export default function BatchTwoThousandOneRegistrationPage() {
  const params = useParams<{ eventSlug: string }>();
  const router = useRouter();
  const eventSlug = String(params?.eventSlug || "");

  const [eventName, setEventName] = React.useState("");

  const [fullName, setFullName] = React.useState("");
  const [mobileNumber, setMobileNumber] = React.useState("");
  const [nickname, setNickname] = React.useState("");
  const [companions, setCompanions] = React.useState<CompanionForm[]>([]);
  const [bringCompanions, setBringCompanions] = React.useState<boolean | null>(null);
  const [morningRole, setMorningRole] = React.useState<"fun_walk" | "assist" | null>(null);
  const [attendLunch, setAttendLunch] = React.useState<boolean | null>(null);

  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState("");
  const [duplicatePrompt, setDuplicatePrompt] = React.useState<RegistrationResponse | null>(null);
  const [specialNotice, setSpecialNotice] = React.useState<RegistrationResponse | null>(null);

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
        // eventName is decorative only - a failed fetch must not block
        // registration.
      }
    }

    if (eventSlug) loadEventName();

    return () => {
      active = false;
    };
  }, [eventSlug]);

  function handleBringCompanions(next: boolean) {
    setBringCompanions(next);
    if (!next) {
      setCompanions([]);
    } else if (companions.length === 0) {
      addCompanion();
    }
  }

  function addCompanion() {
    if (companions.length >= MAX_COMPANIONS) return;
    setCompanions((prev) => [
      ...prev,
      { fullName: "", relationship: "Spouse", joinFunWalk: null, attendLunch: null },
    ]);
  }

  function updateCompanion(index: number, patch: Partial<CompanionForm>) {
    setCompanions((prev) =>
      prev.map((companion, i) => (i === index ? { ...companion, ...patch } : companion))
    );
  }

  function removeCompanion(index: number) {
    setCompanions((prev) => prev.filter((_, i) => i !== index));
  }

  function validateLocal() {
    if (fullName.trim().length < 2) return "Full name is required.";
    if (cleanPhone(mobileNumber).length < 10) return "Valid mobile number is required.";
    if (bringCompanions === null) return "Please answer whether you will bring companions.";
    if (bringCompanions && companions.length === 0) {
      return "Please add at least one companion or select No.";
    }
    if (!morningRole) return "Please choose how you will participate.";
    if (attendLunch === null) {
      return "Please answer whether you will attend the Lunch Meet & Greet.";
    }

    for (let i = 0; i < companions.length; i++) {
      const companion = companions[i];

      if (companion.fullName.trim().length < 2) {
        return `Companion ${i + 1} name is required.`;
      }

      if (!companion.relationship.trim()) {
        return `Companion ${i + 1} relationship is required.`;
      }

      if (companion.joinFunWalk === null) {
        return `Companion ${i + 1}: please answer whether they will join the Fun Walk.`;
      }

      if (companion.attendLunch === null) {
        return `Companion ${i + 1}: please answer whether they will attend the Lunch Meet & Greet.`;
      }
    }

    return "";
  }

  async function submitRegistration(force = false) {
    const localError = validateLocal();

    if (localError) {
      setFormError(localError);
      return;
    }

    setSubmitting(true);
    setFormError("");

    try {
      const res = await fetch(`/api/events/${eventSlug}/register/batch-2001`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          mobileNumber: cleanPhone(mobileNumber),
          nickname: nickname.trim() || undefined,
          morningRole,
          attendLunch,
          companions: companions.map((companion) => ({
            fullName: companion.fullName.trim(),
            relationship: companion.relationship,
            joinFunWalk: companion.joinFunWalk,
            attendLunch: companion.attendLunch,
          })),
          forceDuplicate: force,
        }),
      });

      const data = (await res.json()) as RegistrationResponse;

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "Registration failed.");
      }

      // Must be checked before the requiresReview branch - a matched
      // existing registration is not a "possible duplicate to confirm",
      // it's a definite match the backend already resolved. No auto
      // redirect: their Batch 2001 answers were not saved, and they need
      // to see that stated plainly, not have it flash by before a
      // redirect.
      if (data.specialRegistrationNotApplied) {
        setSpecialNotice(data);
        return;
      }

      if (
        data.identityResolution?.requiresReview &&
        !force &&
        data.identityResolution.matchReasons.includes("name_match")
      ) {
        setDuplicatePrompt(data);
        return;
      }

      if (!data.registrationNumber || !data.qrToken) {
        throw new Error("Registration succeeded but Event Pass details are missing.");
      }

      const destination = `/events/${eventSlug}/pass/${encodeURIComponent(data.registrationNumber)}?token=${encodeURIComponent(
        data.qrToken
      )}`;

      router.push(destination);
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
            Your Batch 2001 details were not saved.
          </h1>
          <p className="mt-4 text-slate-300">
            {specialNotice.message ||
              "This mobile number already has an Event Pass. Please visit Event Registration and Assistance so your Batch 2001 participation details can be updated."}
          </p>

          <a
            href={`/events/${eventSlug}/register`}
            className="mt-6 block rounded-2xl border border-slate-600 px-5 py-4 text-center font-bold text-white"
          >
            Back to Registration
          </a>
        </section>
      </main>
    );
  }

  if (duplicatePrompt) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <section className="mx-auto max-w-md rounded-3xl border border-amber-300/40 bg-slate-900 p-6 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            Possible Duplicate
          </p>
          <h1 className="mt-4 text-3xl font-black">This registration may already exist.</h1>
          <p className="mt-4 text-slate-300">
            If this is you, use Find My Event Pass. If this is another Batch 2001 member with
            the same name, continue registration.
          </p>

          <div className="mt-6 grid gap-3">
            <a
              href="/events"
              className="rounded-2xl border border-slate-600 px-5 py-4 text-center font-bold text-white"
            >
              Find My Event Pass
            </a>
            <button
              type="button"
              onClick={() => submitRegistration(true)}
              disabled={submitting}
              className="rounded-2xl bg-amber-400 px-5 py-4 font-bold text-slate-950 disabled:opacity-60"
            >
              Continue Anyway
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <section className="mx-auto max-w-md">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            JRide Events
          </p>
          <h1 className="mt-4 text-4xl font-black leading-tight">
            {eventName || "Event Registration"}
          </h1>
          <p className="mt-3 text-slate-300">
            Batch 2001 Member Registration. Thank you for supporting the event - please let us
            know how you'll be participating so we can prepare event logistics and the Lunch
            Meet &amp; Greet with the Junior Batch and our Golden Jubilarians.
          </p>

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
                placeholder="09171234567"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
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

            <div className="rounded-2xl border border-slate-700 bg-slate-950 p-4">
              <p className="font-bold">Will you bring companions?</p>
              <p className="mt-1 text-sm text-slate-400">
                Add up to {MAX_COMPANIONS} companions. Each receives their own Event Pass QR.
              </p>

              <YesNo value={bringCompanions} onChange={handleBringCompanions} />

              {bringCompanions ? (
                <>
                  <button
                    type="button"
                    onClick={addCompanion}
                    disabled={companions.length >= MAX_COMPANIONS}
                    className="mt-4 rounded-xl bg-amber-400 px-3 py-2 text-sm font-bold text-slate-950 disabled:opacity-50"
                  >
                    Add Another Companion
                  </button>

                  {companions.length > 0 ? (
                    <div className="mt-4 space-y-4">
                      {companions.map((companion, index) => (
                        <div key={index} className="rounded-2xl border border-slate-700 p-4">
                          <div className="flex items-center justify-between">
                            <p className="font-bold">Companion #{index + 1}</p>
                            <button
                              type="button"
                              onClick={() => removeCompanion(index)}
                              className="text-sm font-bold text-red-300"
                            >
                              Remove
                            </button>
                          </div>

                          <input
                            value={companion.fullName}
                            onChange={(event) =>
                              updateCompanion(index, { fullName: event.target.value })
                            }
                            className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none focus:border-amber-300"
                            placeholder="Companion full name"
                          />

                          <select
                            value={companion.relationship}
                            onChange={(event) =>
                              updateCompanion(index, { relationship: event.target.value })
                            }
                            className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none focus:border-amber-300"
                          >
                            {relationships.map((item) => (
                              <option key={item} value={item}>
                                {item}
                              </option>
                            ))}
                          </select>

                          <div className="mt-3">
                            <span className="text-sm font-bold text-slate-200">
                              Will this companion join the Fun Walk? *
                            </span>
                            <YesNo
                              value={companion.joinFunWalk}
                              onChange={(next) => updateCompanion(index, { joinFunWalk: next })}
                            />
                          </div>

                          <div className="mt-3">
                            <span className="text-sm font-bold text-slate-200">
                              Will this companion attend the Lunch Meet &amp; Greet? *
                            </span>
                            <YesNo
                              value={companion.attendLunch}
                              onChange={(next) => updateCompanion(index, { attendLunch: next })}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-950 p-4">
              <span className="text-sm font-bold text-slate-200">
                How will you participate? *
              </span>
              <div className="mt-2 grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => setMorningRole("fun_walk")}
                  aria-pressed={morningRole === "fun_walk"}
                  className={`rounded-xl border px-4 py-3 text-left font-bold transition ${
                    morningRole === "fun_walk"
                      ? "border-amber-300 bg-amber-400 text-slate-950"
                      : "border-slate-700 bg-slate-900 text-white"
                  }`}
                >
                  Join the Fun Walk
                </button>
                <button
                  type="button"
                  onClick={() => setMorningRole("assist")}
                  aria-pressed={morningRole === "assist"}
                  className={`rounded-xl border px-4 py-3 text-left font-bold transition ${
                    morningRole === "assist"
                      ? "border-amber-300 bg-amber-400 text-slate-950"
                      : "border-slate-700 bg-slate-900 text-white"
                  }`}
                >
                  Assist during the Event
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-950 p-4">
              <span className="text-sm font-bold text-slate-200">
                Will you attend the Lunch Meet &amp; Greet with the Junior Batch and the Golden
                Jubilarians? *
              </span>
              <YesNo value={attendLunch} onChange={setAttendLunch} />
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
      </section>
    </main>
  );
}
