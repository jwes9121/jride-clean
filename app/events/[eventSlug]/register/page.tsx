"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

type GroupValue = {
  value: string;
  label: string;
  sort_order: number;
};

type GroupValuesResponse = {
  success: boolean;
  eventSlug?: string;
  groupLabel?: string;
  values?: GroupValue[];
  error?: string;
};

type GuestForm = {
  fullName: string;
  relationship: string;
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

const relationships = ["Spouse", "Partner", "Child", "Relative", "Friend", "Other"];

function cleanPhone(value: string) {
  return value.replace(/[^0-9]/g, "");
}

export default function EventRegistrationPage() {
  const params = useParams<{ eventSlug: string }>();
  const router = useRouter();
  const eventSlug = String(params?.eventSlug || "");

  const [groupLabel, setGroupLabel] = React.useState("Batch");
  const [groupValues, setGroupValues] = React.useState<GroupValue[]>([]);
  const [loadingGroups, setLoadingGroups] = React.useState(true);
  const [groupError, setGroupError] = React.useState("");

  const [fullName, setFullName] = React.useState("");
  const [mobileNumber, setMobileNumber] = React.useState("");
  const [groupValue, setGroupValue] = React.useState("");
  const [nickname, setNickname] = React.useState("");
  const [guests, setGuests] = React.useState<GuestForm[]>([]);

  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState("");
  const [existingNotice, setExistingNotice] = React.useState("");
  const [duplicatePrompt, setDuplicatePrompt] = React.useState<RegistrationResponse | null>(null);

  React.useEffect(() => {
    let active = true;

    async function loadGroupValues() {
      setLoadingGroups(true);
      setGroupError("");

      try {
        const res = await fetch(`/api/events/${eventSlug}/group-values`, {
          cache: "no-store",
        });

        const data = (await res.json()) as GroupValuesResponse;

        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to load registration options.");
        }

        if (!active) return;

        setGroupLabel(data.groupLabel || "Batch");
        setGroupValues(data.values || []);
      } catch (error) {
        if (!active) return;
        setGroupError(
          error instanceof Error ? error.message : "Failed to load registration options."
        );
      } finally {
        if (active) setLoadingGroups(false);
      }
    }

    if (eventSlug) loadGroupValues();

    return () => {
      active = false;
    };
  }, [eventSlug]);

  function addGuest() {
    if (guests.length >= 3) return;
    setGuests((prev) => [...prev, { fullName: "", relationship: "Spouse" }]);
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
    if (!groupValue) return `${groupLabel} is required.`;

    for (let i = 0; i < guests.length; i++) {
      if (guests[i].fullName.trim().length < 2) {
        return `Guest ${i + 1} name is required.`;
      }

      if (!guests[i].relationship.trim()) {
        return `Guest ${i + 1} relationship is required.`;
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
    setExistingNotice("");

    try {
      const res = await fetch(`/api/events/${eventSlug}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          mobileNumber: cleanPhone(mobileNumber),
          groupValue,
          nickname: nickname.trim() || undefined,
          guests: guests.map((guest) => ({
            fullName: guest.fullName.trim(),
            relationship: guest.relationship,
            hasOwnQr: true,
          })),
          forceDuplicate: force,
        }),
      });

      const data = (await res.json()) as RegistrationResponse;

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "Registration failed.");
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

      if (data.existingRegistration) {
        setExistingNotice(
          data.message ||
            `This mobile number is already registered. Opening existing Event Pass for ${data.existingName || "the existing registrant"}.`
        );
        window.setTimeout(() => router.push(destination), 2000);
        return;
      }

      router.push(destination);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Registration failed.");
    } finally {
      setSubmitting(false);
    }
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
            If this is you, use Find My Event Pass. If this is another person with the same
            name and {groupLabel.toLowerCase()}, continue registration.
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
          <h1 className="mt-4 text-4xl font-black leading-tight">Join the Reunion</h1>
          <p className="mt-3 text-slate-300">
            Register early and present your Event Pass QR at the entrance for faster check-in.
          </p>

          <div className="mt-6 rounded-2xl bg-slate-950 p-4 text-sm text-slate-300">
            Already have JRide?{" "}
            <a href="/passenger-login" className="font-bold text-amber-300">
              Sign in
            </a>
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
                placeholder="09171234567"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="tel"
              />
            </label>

            <label className="block">
              <span className="text-sm font-bold text-slate-200">{groupLabel} *</span>
              <select
                value={groupValue}
                onChange={(event) => setGroupValue(event.target.value)}
                disabled={loadingGroups || !!groupError}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-white outline-none focus:border-amber-300"
              >
                <option value="">
                  {loadingGroups ? "Loading..." : `Select ${groupLabel}`}
                </option>
                {groupValues.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            {groupError ? (
              <p className="rounded-2xl bg-red-100 px-4 py-3 text-sm font-semibold text-red-800">
                {groupError}
              </p>
            ) : null}

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
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-bold">Guests (optional)</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Add up to 3 guests online. Extra guests can be added at the Help Desk.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addGuest}
                  disabled={guests.length >= 3}
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
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {existingNotice ? (
              <p className="rounded-2xl bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-900">
                {existingNotice}
              </p>
            ) : null}

            {formError ? (
              <p className="rounded-2xl bg-red-100 px-4 py-3 text-sm font-semibold text-red-800">
                {formError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting || loadingGroups || !!groupError}
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