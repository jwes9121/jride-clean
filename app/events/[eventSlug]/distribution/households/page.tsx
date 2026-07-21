"use client";

import * as React from "react";
import { useParams } from "next/navigation";

type Entitlement = {
  id: string;
  beneficiary_id: string;
  item_key: string;
  item_name: string;
  quantity: number | string;
  unit_label: string;
  claim_token: string;
  status: string;
  allocated_at: string;
  claimed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
};

type Household = {
  id: string;
  beneficiary_type: string;
  beneficiary_code: string;
  display_name: string;
  household_head_name: string | null;
  mobile_number: string | null;
  municipality: string | null;
  barangay: string | null;
  address_text: string | null;
  member_count: number | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  entitlement: Entitlement | null;
};

type HouseholdsResponse = {
  success: boolean;
  reason?: string;
  message?: string;
  error?: string;
  event?: {
    id: string;
    slug: string;
    name: string;
    status: string;
  };
  program?: {
    id: string;
    event_id: string;
    program_key: string;
    program_name: string;
    beneficiary_label: string;
    item_label: string;
    claim_label: string;
    status: string;
    starts_at: string | null;
    ends_at: string | null;
  };
  summary?: {
    households: number;
    allocated: number;
    claimed: number;
    cancelled: number;
    activeBeneficiaries: number;
  };
  households?: Household[];
  household?: Household;
};

type FormState = {
  displayName: string;
  householdHeadName: string;
  mobileNumber: string;
  municipality: string;
  barangay: string;
  addressText: string;
  memberCount: string;
  quantity: string;
  unitLabel: string;
  notes: string;
};

const initialForm: FormState = {
  displayName: "",
  householdHeadName: "",
  mobileNumber: "",
  municipality: "",
  barangay: "",
  addressText: "",
  memberCount: "",
  quantity: "1",
  unitLabel: "portion",
  notes: "",
};

function formatDateTime(
  value: string | null | undefined
) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    "en-PH",
    {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }
  ).format(new Date(value));
}

function formatQuantity(
  value: number | string | undefined,
  unitLabel: string | undefined
) {
  const numericValue =
    value === undefined
      ? Number.NaN
      : Number(value);

  const quantityText =
    Number.isFinite(numericValue)
      ? new Intl.NumberFormat(
          "en-PH",
          {
            maximumFractionDigits: 3,
          }
        ).format(numericValue)
      : String(value || "");

  return `${quantityText} ${unitLabel || ""}`.trim();
}

function statusBadge(status: string) {
  if (status === "claimed") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "cancelled") {
    return "bg-red-100 text-red-800";
  }

  if (status === "allocated") {
    return "bg-amber-100 text-amber-900";
  }

  return "bg-slate-200 text-slate-700";
}

export default function HongaHouseholdsPage() {
  const params = useParams<{
    eventSlug: string;
  }>();

  const eventSlug = String(
    params?.eventSlug || ""
  );

  const [data, setData] =
    React.useState<HouseholdsResponse | null>(
      null
    );

  const [loading, setLoading] =
    React.useState(true);

  const [saving, setSaving] =
    React.useState(false);

  const [error, setError] =
    React.useState("");

  const [successMessage, setSuccessMessage] =
    React.useState("");

  const [query, setQuery] =
    React.useState("");

  const [statusFilter, setStatusFilter] =
    React.useState("all");

  const [municipalityFilter, setMunicipalityFilter] =
    React.useState("all");

  const [barangayFilter, setBarangayFilter] =
    React.useState("all");

  const [form, setForm] =
    React.useState<FormState>(
      initialForm
    );

  const [showForm, setShowForm] =
    React.useState(false);

  const [copiedToken, setCopiedToken] =
    React.useState("");

  const [selectedHousehold, setSelectedHousehold] =
    React.useState<Household | null>(
      null
    );

  async function loadHouseholds() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/events/${eventSlug}/distribution/households`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const payload =
        (await response.json()) as HouseholdsResponse;

      if (
        !response.ok ||
        !payload.success
      ) {
        throw new Error(
          payload.message ||
            payload.error ||
            "Unable to load households."
        );
      }

      setData(payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load households."
      );
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!eventSlug) {
      return;
    }

    void loadHouseholds();
  }, [eventSlug]);

  function updateForm(
    key: keyof FormState,
    value: string
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function submitHousehold(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!form.displayName.trim()) {
      setError(
        "Household display name is required."
      );
      return;
    }

    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await fetch(
        `/api/events/${eventSlug}/distribution/households`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            displayName:
              form.displayName.trim(),
            householdHeadName:
              form.householdHeadName.trim(),
            mobileNumber:
              form.mobileNumber.trim(),
            municipality:
              form.municipality.trim(),
            barangay:
              form.barangay.trim(),
            addressText:
              form.addressText.trim(),
            memberCount:
              form.memberCount === ""
                ? null
                : Number(
                    form.memberCount
                  ),
            quantity: Number(
              form.quantity
            ),
            unitLabel:
              form.unitLabel.trim(),
            notes: form.notes.trim(),
          }),
        }
      );

      const payload =
        (await response.json()) as HouseholdsResponse;

      if (
        !response.ok ||
        !payload.success
      ) {
        throw new Error(
          payload.message ||
            payload.error ||
            "Unable to register household."
        );
      }

      setSuccessMessage(
        "Household and Pahing entitlement created."
      );

      setForm(initialForm);
      setShowForm(false);

      await loadHouseholds();

      if (payload.household) {
        setSelectedHousehold(
          payload.household
        );
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to register household."
      );
    } finally {
      setSaving(false);
    }
  }

  async function copyText(
    text: string,
    key: string
  ) {
    try {
      await navigator.clipboard.writeText(
        text
      );

      setCopiedToken(key);

      window.setTimeout(() => {
        setCopiedToken((current) =>
          current === key ? "" : current
        );
      }, 1500);
    } catch {
      setError(
        "Unable to copy. Select and copy the value manually."
      );
    }
  }

  const households =
    data?.households || [];

  const municipalities = Array.from(
    new Set(
      households
        .map((household) =>
          String(
            household.municipality || ""
          ).trim()
        )
        .filter(Boolean)
    )
  ).sort((a, b) =>
    a.localeCompare(b)
  );

  const barangays = Array.from(
    new Set(
      households
        .filter(
          (household) =>
            municipalityFilter === "all" ||
            household.municipality ===
              municipalityFilter
        )
        .map((household) =>
          String(
            household.barangay || ""
          ).trim()
        )
        .filter(Boolean)
    )
  ).sort((a, b) =>
    a.localeCompare(b)
  );

  const statusPriority: Record<
    string,
    number
  > = {
    allocated: 0,
    none: 1,
    cancelled: 2,
    claimed: 3,
  };

  const filteredHouseholds =
    households
      .filter((household) => {
        const entitlementStatus =
          household.entitlement?.status ||
          "none";

        if (
          statusFilter !== "all" &&
          entitlementStatus !==
            statusFilter
        ) {
          return false;
        }

        if (
          municipalityFilter !== "all" &&
          household.municipality !==
            municipalityFilter
        ) {
          return false;
        }

        if (
          barangayFilter !== "all" &&
          household.barangay !==
            barangayFilter
        ) {
          return false;
        }

        const normalizedQuery =
          query.trim().toLowerCase();

        if (!normalizedQuery) {
          return true;
        }

        const searchable = [
          household.display_name,
          household.beneficiary_code,
          household.household_head_name,
          household.mobile_number,
          household.municipality,
          household.barangay,
          household.address_text,
          household.status,
          household.entitlement?.status,
          household.entitlement?.claim_token,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchable.includes(
          normalizedQuery
        );
      })
      .sort((a, b) => {
        const aStatus =
          a.entitlement?.status || "none";

        const bStatus =
          b.entitlement?.status || "none";

        const priorityDifference =
          (statusPriority[aStatus] ?? 9) -
          (statusPriority[bStatus] ?? 9);

        if (priorityDifference !== 0) {
          return priorityDifference;
        }

        return a.display_name.localeCompare(
          b.display_name
        );
      });

  const selectedClaimUrl =
    selectedHousehold?.entitlement
      ?.claim_token &&
    typeof window !== "undefined"
      ? `${window.location.origin}/events/${eventSlug}/distribution/claim?token=${encodeURIComponent(
          selectedHousehold.entitlement
            .claim_token
        )}`
      : "";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950">
      <section className="mx-auto max-w-7xl">
        <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.25em] text-amber-300">
                JRide Events
              </p>

              <h1 className="mt-3 text-3xl font-black md:text-4xl">
                Honga Household Distribution
              </h1>

              <p className="mt-2 text-slate-300">
                {data?.event?.name ||
                  eventSlug}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <a
                href={`/events/${eventSlug}/distribution/claim`}
                className="rounded-2xl border border-slate-600 px-5 py-3 font-black text-white"
              >
                Open Claim Scanner
              </a>

              <button
                type="button"
                onClick={() =>
                  setShowForm(true)
                }
                className="rounded-2xl bg-amber-400 px-5 py-3 font-black text-slate-950"
              >
                Register Household
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4 font-bold text-red-800">
            {error}
          </div>
        ) : null}

        {successMessage ? (
          <div className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-800">
            {successMessage}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            [
              "Households",
              data?.summary?.households ??
                0,
            ],
            [
              "Allocated",
              data?.summary?.allocated ??
                0,
            ],
            [
              "Claimed",
              data?.summary?.claimed ??
                0,
            ],
            [
              "Cancelled",
              data?.summary?.cancelled ??
                0,
            ],
            [
              "Active",
              data?.summary
                ?.activeBeneficiaries ??
                0,
            ],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                {label}
              </p>

              <p className="mt-3 text-4xl font-black">
                {value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 xl:grid-cols-[minmax(260px,1fr)_190px_190px_180px_auto]">
            <input
              value={query}
              onChange={(event) =>
                setQuery(event.target.value)
              }
              placeholder="Search name, code, mobile, or token"
              className="rounded-2xl border border-slate-300 px-4 py-3 font-semibold outline-none focus:border-slate-950"
            />

            <select
              value={municipalityFilter}
              onChange={(event) => {
                setMunicipalityFilter(
                  event.target.value
                );
                setBarangayFilter("all");
              }}
              className="rounded-2xl border border-slate-300 px-4 py-3 font-semibold outline-none focus:border-slate-950"
            >
              <option value="all">
                All municipalities
              </option>

              {municipalities.map(
                (municipality) => (
                  <option
                    key={municipality}
                    value={municipality}
                  >
                    {municipality}
                  </option>
                )
              )}
            </select>

            <select
              value={barangayFilter}
              onChange={(event) =>
                setBarangayFilter(
                  event.target.value
                )
              }
              className="rounded-2xl border border-slate-300 px-4 py-3 font-semibold outline-none focus:border-slate-950"
            >
              <option value="all">
                All barangays
              </option>

              {barangays.map(
                (barangay) => (
                  <option
                    key={barangay}
                    value={barangay}
                  >
                    {barangay}
                  </option>
                )
              )}
            </select>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value
                )
              }
              className="rounded-2xl border border-slate-300 px-4 py-3 font-semibold outline-none focus:border-slate-950"
            >
              <option value="all">
                All statuses
              </option>
              <option value="allocated">
                Unclaimed
              </option>
              <option value="claimed">
                Claimed
              </option>
              <option value="cancelled">
                Cancelled
              </option>
              <option value="none">
                No entitlement
              </option>
            </select>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setMunicipalityFilter(
                    "all"
                  );
                  setBarangayFilter("all");
                  setStatusFilter("all");
                }}
                className="rounded-2xl border border-slate-300 px-4 py-3 font-black"
              >
                Clear
              </button>

              <button
                type="button"
                onClick={() =>
                  void loadHouseholds()
                }
                className="rounded-2xl bg-slate-950 px-4 py-3 font-black text-white"
              >
                Refresh
              </button>
            </div>
          </div>

          <p className="mt-4 text-sm font-semibold text-slate-500">
            Unclaimed households are listed first, followed by cancelled and claimed records.
          </p>
        </div>

        <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-slate-950 text-left text-white">
                <tr>
                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.15em]">
                    Household
                  </th>
                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.15em]">
                    Location
                  </th>
                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.15em]">
                    Members
                  </th>
                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.15em]">
                    Pahing
                  </th>
                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.15em]">
                    Status
                  </th>
                  <th className="px-5 py-4 text-xs font-black uppercase tracking-[0.15em]">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-12 text-center font-bold text-slate-500"
                    >
                      Loading households...
                    </td>
                  </tr>
                ) : filteredHouseholds.length ===
                  0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-12 text-center font-bold text-slate-500"
                    >
                      No households found.
                    </td>
                  </tr>
                ) : (
                  filteredHouseholds.map(
                    (household) => {
                      const entitlement =
                        household.entitlement;

                      const status =
                        entitlement?.status ||
                        "none";

                      return (
                        <tr
                          key={household.id}
                          className="border-t border-slate-200 align-top"
                        >
                          <td className="px-5 py-5">
                            <p className="font-black">
                              {
                                household.display_name
                              }
                            </p>

                            <p className="mt-1 font-mono text-xs font-bold text-slate-500">
                              {
                                household.beneficiary_code
                              }
                            </p>

                            {household.household_head_name ? (
                              <p className="mt-2 text-sm text-slate-600">
                                Head:{" "}
                                {
                                  household.household_head_name
                                }
                              </p>
                            ) : null}

                            {household.mobile_number ? (
                              <p className="mt-1 text-sm text-slate-600">
                                {
                                  household.mobile_number
                                }
                              </p>
                            ) : null}
                          </td>

                          <td className="px-5 py-5 text-sm">
                            <p className="font-bold">
                              {[
                                household.barangay,
                                household.municipality,
                              ]
                                .filter(Boolean)
                                .join(", ") ||
                                "-"}
                            </p>

                            {household.address_text ? (
                              <p className="mt-2 max-w-xs text-slate-500">
                                {
                                  household.address_text
                                }
                              </p>
                            ) : null}
                          </td>

                          <td className="px-5 py-5 text-2xl font-black">
                            {household.member_count ??
                              "-"}
                          </td>

                          <td className="px-5 py-5">
                            {entitlement ? (
                              <>
                                <p className="font-black">
                                  {formatQuantity(
                                    entitlement.quantity,
                                    entitlement.unit_label
                                  )}
                                </p>

                                <p className="mt-1 text-sm text-slate-500">
                                  {
                                    entitlement.item_name
                                  }
                                </p>
                              </>
                            ) : (
                              <span className="text-slate-400">
                                None
                              </span>
                            )}
                          </td>

                          <td className="px-5 py-5">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.1em] ${statusBadge(
                                status
                              )}`}
                            >
                              {status}
                            </span>

                            {entitlement?.claimed_at ? (
                              <p className="mt-2 text-xs text-slate-500">
                                {formatDateTime(
                                  entitlement.claimed_at
                                )}
                              </p>
                            ) : null}
                          </td>

                          <td className="px-5 py-5">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedHousehold(
                                    household
                                  )
                                }
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-950"
                              >
                                View Details
                              </button>

                              <a
                                href={`/events/${eventSlug}/distribution/households/${household.id}/stub`}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white"
                              >
                                Print Stub
                              </a>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {showForm ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4">
          <div className="mx-auto my-8 max-w-3xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">
                  Honga Pahing
                </p>

                <h2 className="mt-2 text-3xl font-black">
                  Register Household
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowForm(false)
                }
                className="rounded-xl border border-slate-300 px-4 py-2 font-black"
              >
                Close
              </button>
            </div>

            <form
              onSubmit={submitHousehold}
              className="mt-6 grid gap-5"
            >
              <div className="grid gap-5 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-black">
                    Household Display Name
                  </span>

                  <input
                    required
                    value={form.displayName}
                    onChange={(event) =>
                      updateForm(
                        "displayName",
                        event.target.value
                      )
                    }
                    placeholder="Example: Ammayao Household"
                    className="rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-black">
                    Household Head
                  </span>

                  <input
                    value={
                      form.householdHeadName
                    }
                    onChange={(event) =>
                      updateForm(
                        "householdHeadName",
                        event.target.value
                      )
                    }
                    className="rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-black">
                    Mobile Number
                  </span>

                  <input
                    value={form.mobileNumber}
                    onChange={(event) =>
                      updateForm(
                        "mobileNumber",
                        event.target.value
                      )
                    }
                    className="rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-black">
                    Member Count
                  </span>

                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.memberCount}
                    onChange={(event) =>
                      updateForm(
                        "memberCount",
                        event.target.value
                      )
                    }
                    className="rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-black">
                    Municipality
                  </span>

                  <input
                    value={form.municipality}
                    onChange={(event) =>
                      updateForm(
                        "municipality",
                        event.target.value
                      )
                    }
                    className="rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-black">
                    Barangay
                  </span>

                  <input
                    value={form.barangay}
                    onChange={(event) =>
                      updateForm(
                        "barangay",
                        event.target.value
                      )
                    }
                    className="rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
                  />
                </label>
              </div>

              <label className="grid gap-2">
                <span className="text-sm font-black">
                  Address Details
                </span>

                <textarea
                  value={form.addressText}
                  onChange={(event) =>
                    updateForm(
                      "addressText",
                      event.target.value
                    )
                  }
                  rows={3}
                  className="rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
                />
              </label>

              <div className="grid gap-5 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-black">
                    Pahing Quantity
                  </span>

                  <input
                    required
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={form.quantity}
                    onChange={(event) =>
                      updateForm(
                        "quantity",
                        event.target.value
                      )
                    }
                    className="rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-black">
                    Unit
                  </span>

                  <input
                    required
                    value={form.unitLabel}
                    onChange={(event) =>
                      updateForm(
                        "unitLabel",
                        event.target.value
                      )
                    }
                    placeholder="portion"
                    className="rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
                  />
                </label>
              </div>

              <label className="grid gap-2">
                <span className="text-sm font-black">
                  Notes
                </span>

                <textarea
                  value={form.notes}
                  onChange={(event) =>
                    updateForm(
                      "notes",
                      event.target.value
                    )
                  }
                  rows={3}
                  className="rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-950"
                />
              </label>

              <button
                type="submit"
                disabled={saving}
                className="rounded-2xl bg-slate-950 px-5 py-4 font-black text-white disabled:opacity-50"
              >
                {saving
                  ? "Creating..."
                  : "Create Household and Entitlement"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {selectedHousehold ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4">
          <div className="mx-auto my-8 max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">
                  Household Claim Stub
                </p>

                <h2 className="mt-2 text-3xl font-black">
                  {
                    selectedHousehold.display_name
                  }
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSelectedHousehold(
                    null
                  )
                }
                className="rounded-xl border border-slate-300 px-4 py-2 font-black"
              >
                Close
              </button>
            </div>

            <div className="mt-6 rounded-3xl bg-slate-950 p-6 text-white">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                Household Code
              </p>

              <p className="mt-2 font-mono text-2xl font-black">
                {
                  selectedHousehold.beneficiary_code
                }
              </p>

              <div className="mt-6 rounded-2xl bg-white p-5 text-slate-950">
                <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                  Pahing Entitlement
                </p>

                <p className="mt-2 text-3xl font-black">
                  {selectedHousehold.entitlement
                    ? formatQuantity(
                        selectedHousehold
                          .entitlement
                          .quantity,
                        selectedHousehold
                          .entitlement
                          .unit_label
                      )
                    : "No entitlement"}
                </p>

                <p className="mt-2 font-bold text-slate-600">
                  {selectedHousehold.entitlement
                    ?.item_name || ""}
                </p>
              </div>
            </div>

            {selectedHousehold.entitlement ? (
              <>
                <a
                  href={`/events/${eventSlug}/distribution/households/${selectedHousehold.id}/stub`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-6 block w-full rounded-2xl bg-amber-400 px-5 py-4 text-center font-black text-slate-950"
                >
                  Open Printable Stub
                </a>

                <div className="mt-6">
                  <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                    Claim Token
                  </p>

                  <div className="mt-2 rounded-2xl border border-slate-300 bg-slate-50 p-4">
                    <p className="break-all font-mono text-sm font-bold">
                      {
                        selectedHousehold
                          .entitlement
                          .claim_token
                      }
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      void copyText(
                        selectedHousehold
                          .entitlement
                          ?.claim_token || "",
                        "token"
                      )
                    }
                    className="mt-3 w-full rounded-2xl border border-slate-300 px-5 py-3 font-black"
                  >
                    {copiedToken === "token"
                      ? "Token Copied"
                      : "Copy Claim Token"}
                  </button>
                </div>

                <div className="mt-6">
                  <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                    Claim URL
                  </p>

                  <div className="mt-2 rounded-2xl border border-slate-300 bg-slate-50 p-4">
                    <p className="break-all text-sm font-bold">
                      {selectedClaimUrl}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      void copyText(
                        selectedClaimUrl,
                        "url"
                      )
                    }
                    className="mt-3 w-full rounded-2xl bg-slate-950 px-5 py-3 font-black text-white"
                  >
                    {copiedToken === "url"
                      ? "URL Copied"
                      : "Copy Claim URL"}
                  </button>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                      Status
                    </p>

                    <p className="mt-2 font-black uppercase">
                      {
                        selectedHousehold
                          .entitlement
                          .status
                      }
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-100 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                      Allocated
                    </p>

                    <p className="mt-2 font-bold">
                      {formatDateTime(
                        selectedHousehold
                          .entitlement
                          .allocated_at
                      )}
                    </p>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
