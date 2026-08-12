"use client";

import * as React from "react";

type QuickAddDecision =
  | "NO_PARENT_PROPOSED"
  | "SAFE_TO_LINK"
  | "ALREADY_LINKED"
  | "ADVANCED_EDITOR_REQUIRED"
  | "CYCLE_WOULD_BE_CREATED";

type Candidate = {
  candidateId: string;
  fullName: string;
  nickname: string | null;
  locationText: string | null;
  locationBucket: string | null;
  matchScope: "CURRENT_FAMILY" | "OTHER_FAMILY";
  organizationalFamily: {
    id: string;
    name: string | null;
  } | null;
  similarityScore: number;
  biologicalParentCount: number;
  biologicalParents: {
    id: string;
    fullName: string;
  }[];
  proposedParentAlreadyLinked: boolean;
  cycleWouldBeCreated: boolean;
  quickAddDecision: QuickAddDecision;
};

type CandidateResponse = {
  success: boolean;
  error?: string;
  currentFamilyMatches?: Candidate[];
  otherFamilyMatches?: Candidate[];
};

type ParentSummaryResponse = {
  success: boolean;
  error?: string;
  child?: {
    id: string;
    fullName: string;
    biologicalParentCount: number;
    biologicalParents: {
      id: string;
      fullName: string;
    }[];
  };
};

type SiblingMode = "create_new" | "use_existing";
type ReviewState = "unreviewed" | "reviewed" | "error";

type CandidateReview = {
  candidate: Candidate;
  decisionsByParentId: Record<string, QuickAddDecision>;
};

type SiblingDraft = {
  rowId: string;
  fullName: string;
  sex: string;
  locationText: string;
  reviewState: ReviewState;
  candidateReviews: CandidateReview[];
  selectedMode: SiblingMode | null;
  selectedExistingPersonId: string | null;
  differentPersonConfirmed: boolean;
  error: string | null;
};

type WriteResponse = {
  success: boolean;
  resultCode?: string;
  processedCount?: number;
  message?: string;
  error?: string;
};

type Props = {
  familyId: string;
  referencePersonId: string;
  referencePersonName: string;
  referenceGeneration: number | null;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
};

let siblingRowSequence = 0;

function createSiblingDraft(): SiblingDraft {
  siblingRowSequence += 1;

  return {
    rowId: `sibling-row-${siblingRowSequence}`,
    fullName: "",
    sex: "unspecified",
    locationText: "",
    reviewState: "unreviewed",
    candidateReviews: [],
    selectedMode: null,
    selectedExistingPersonId: null,
    differentPersonConfirmed: false,
    error: null,
  };
}

function normalizedName(value: string) {
  return value.trim().toLowerCase();
}

function branchLabel(
  parents: { id: string; fullName: string }[],
  selectedParentIds: string[]
) {
  return parents
    .filter((parent) => selectedParentIds.includes(parent.id))
    .map((parent) => parent.fullName)
    .join(" + ");
}

export default function SiblingEntryPanel({
  familyId,
  referencePersonId,
  referencePersonName,
  referenceGeneration,
  onClose,
  onSaved,
}: Props) {
  const [loadingParents, setLoadingParents] = React.useState(true);
  const [biologicalParents, setBiologicalParents] = React.useState<
    { id: string; fullName: string }[]
  >([]);
  const [selectedParentIds, setSelectedParentIds] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<SiblingDraft[]>([
    createSiblingDraft(),
    createSiblingDraft(),
    createSiblingDraft(),
  ]);
  const [reviewing, setReviewing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function loadParents() {
      setLoadingParents(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          childPersonId: referencePersonId,
          q: "",
        });

        const response = await fetch(
          `/api/events/family-reunions/${encodeURIComponent(
            familyId
          )}/quick-add/parent-candidates?${params.toString()}`,
          { method: "GET", cache: "no-store" }
        );

        const data = (await response.json()) as ParentSummaryResponse;

        if (cancelled) return;

        if (!response.ok || !data.success || !data.child) {
          setBiologicalParents([]);
          setSelectedParentIds([]);
          setError(data.error || "Failed to load the selected person's biological parents.");
          return;
        }

        const parents = data.child.biologicalParents || [];
        setBiologicalParents(parents);

        if (parents.length === 1) {
          setSelectedParentIds([parents[0].id]);
        } else {
          // Two-parent branches are intentionally not preselected.
          // The operator must explicitly choose full siblings or one
          // biological parent for a half-sibling branch.
          setSelectedParentIds([]);
        }
      } catch (caught) {
        if (cancelled) return;
        setBiologicalParents([]);
        setSelectedParentIds([]);
        setError(
          caught instanceof Error
            ? caught.message
            : "Failed to load biological parents."
        );
      } finally {
        if (!cancelled) setLoadingParents(false);
      }
    }

    void loadParents();

    return () => {
      cancelled = true;
    };
  }, [familyId, referencePersonId]);

  function resetReviews() {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        reviewState: "unreviewed" as ReviewState,
        candidateReviews: [],
        selectedMode: null,
        selectedExistingPersonId: null,
        differentPersonConfirmed: false,
        error: null,
      }))
    );
    setError(null);
  }

  function chooseBranch(parentIds: string[]) {
    setSelectedParentIds(parentIds);
    resetReviews();
  }

  function updateRow(
    rowId: string,
    patch: Partial<SiblingDraft>,
    resetReview = false
  ) {
    setRows((current) =>
      current.map((row) =>
        row.rowId === rowId
          ? {
              ...row,
              ...patch,
              ...(resetReview
                ? {
                    reviewState: "unreviewed" as ReviewState,
                    candidateReviews: [],
                    selectedMode: null,
                    selectedExistingPersonId: null,
                    differentPersonConfirmed: false,
                    error: null,
                  }
                : {}),
            }
          : row
      )
    );
    setError(null);
  }

  function addRow() {
    setRows((current) =>
      current.length >= 20
        ? current
        : [...current, createSiblingDraft()]
    );
  }

  function removeRow(rowId: string) {
    setRows((current) => {
      const next = current.filter((row) => row.rowId !== rowId);
      return next.length > 0 ? next : [createSiblingDraft()];
    });
    setError(null);
  }

  function canUseCandidate(review: CandidateReview) {
    const candidate = review.candidate;

    if (candidate.candidateId === referencePersonId) return false;

    const decisions = selectedParentIds.map(
      (parentId) => review.decisionsByParentId[parentId]
    );

    if (
      decisions.some(
        (decision) =>
          decision !== "SAFE_TO_LINK" && decision !== "ALREADY_LINKED"
      )
    ) {
      return false;
    }

    if (!decisions.some((decision) => decision === "SAFE_TO_LINK")) {
      return false;
    }

    const prospectiveParents = new Set(
      candidate.biologicalParents.map((parent) => parent.id)
    );

    for (const parentId of selectedParentIds) {
      prospectiveParents.add(parentId);
    }

    return prospectiveParents.size <= 2;
  }

  function candidateStatusText(review: CandidateReview) {
    if (review.candidate.candidateId === referencePersonId) {
      return "The selected person cannot be added as their own sibling.";
    }

    const decisions = selectedParentIds.map(
      (parentId) => review.decisionsByParentId[parentId]
    );

    if (
      decisions.some((decision) => !decision)
    ) {
      return "This possible match could not be safely evaluated against every selected biological parent. Review it in Advanced Genealogy Editor instead of linking it here.";
    }

    if (decisions.includes("CYCLE_WOULD_BE_CREATED")) {
      return "This existing record cannot be linked to this sibling branch because it would create an ancestry cycle.";
    }

    if (decisions.includes("ADVANCED_EDITOR_REQUIRED")) {
      return "This existing record needs Advanced Genealogy Editor because the selected branch would exceed the biological-parent limit.";
    }

    if (decisions.every((decision) => decision === "ALREADY_LINKED")) {
      return "This person is already fully linked to the selected sibling branch.";
    }

    const prospectiveParents = new Set(
      review.candidate.biologicalParents.map((parent) => parent.id)
    );
    selectedParentIds.forEach((parentId) => prospectiveParents.add(parentId));

    if (prospectiveParents.size > 2) {
      return "This existing record cannot use the selected sibling branch because it would exceed two biological parents.";
    }

    return "This existing person can be linked to the selected sibling branch.";
  }

  async function reviewRows() {
    if (selectedParentIds.length < 1) {
      setError("Choose a biological parent branch first.");
      return;
    }

    const activeRows = rows.filter((row) => row.fullName.trim());

    if (activeRows.length === 0) {
      setError("Enter at least one sibling name.");
      return;
    }

    setReviewing(true);
    setError(null);

    const reviewedRows = await Promise.all(
      rows.map(async (row) => {
        const query = row.fullName.trim();

        if (!query) {
          return {
            ...row,
            reviewState: "unreviewed" as ReviewState,
            candidateReviews: [],
            selectedMode: null,
            selectedExistingPersonId: null,
            differentPersonConfirmed: false,
            error: null,
          };
        }

        try {
          const responses = await Promise.all(
            selectedParentIds.map(async (parentId) => {
              const params = new URLSearchParams({
                q: query,
                proposedParentId: parentId,
              });

              const response = await fetch(
                `/api/events/family-reunions/${encodeURIComponent(
                  familyId
                )}/quick-add/candidates?${params.toString()}`,
                { method: "GET", cache: "no-store" }
              );

              const data = (await response.json()) as CandidateResponse;

              if (!response.ok || !data.success) {
                throw new Error(
                  data.error || "Failed to review this sibling against existing people."
                );
              }

              return { parentId, data };
            })
          );

          const candidateMap = new Map<string, CandidateReview>();

          for (const { parentId, data } of responses) {
            for (const candidate of [
              ...(data.currentFamilyMatches || []),
              ...(data.otherFamilyMatches || []),
            ]) {
              const existing = candidateMap.get(candidate.candidateId);

              if (existing) {
                existing.decisionsByParentId[parentId] = candidate.quickAddDecision;
              } else {
                candidateMap.set(candidate.candidateId, {
                  candidate,
                  decisionsByParentId: {
                    [parentId]: candidate.quickAddDecision,
                  },
                });
              }
            }
          }

          const candidateReviews = Array.from(candidateMap.values()).sort(
            (left, right) =>
              right.candidate.similarityScore - left.candidate.similarityScore
          );
          const hasMatches = candidateReviews.length > 0;

          return {
            ...row,
            reviewState: "reviewed" as ReviewState,
            candidateReviews,
            selectedMode: hasMatches
              ? null
              : ("create_new" as SiblingMode),
            selectedExistingPersonId: null,
            differentPersonConfirmed: !hasMatches,
            error: null,
          };
        } catch (caught) {
          return {
            ...row,
            reviewState: "error" as ReviewState,
            candidateReviews: [],
            selectedMode: null,
            selectedExistingPersonId: null,
            differentPersonConfirmed: false,
            error:
              caught instanceof Error
                ? caught.message
                : "Failed to review this sibling.",
          };
        }
      })
    );

    setRows(reviewedRows);
    setReviewing(false);
  }

  function selectExisting(rowId: string, review: CandidateReview) {
    if (!canUseCandidate(review)) return;

    const duplicateSelection = rows.some(
      (row) =>
        row.rowId !== rowId &&
        row.selectedMode === "use_existing" &&
        row.selectedExistingPersonId === review.candidate.candidateId
    );

    if (duplicateSelection) {
      setError("The same existing person cannot be selected in two sibling rows.");
      return;
    }

    updateRow(rowId, {
      selectedMode: "use_existing",
      selectedExistingPersonId: review.candidate.candidateId,
      differentPersonConfirmed: false,
      error: null,
    });
  }

  function confirmDifferentPerson(rowId: string) {
    updateRow(rowId, {
      selectedMode: "create_new",
      selectedExistingPersonId: null,
      differentPersonConfirmed: true,
      error: null,
    });
  }

  async function saveSiblings() {
    const activeRows = rows.filter((row) => row.fullName.trim());

    if (selectedParentIds.length < 1) {
      setError("Choose a biological parent branch first.");
      return;
    }

    if (activeRows.length === 0) {
      setError("Enter at least one sibling name.");
      return;
    }

    const unreviewedIndex = activeRows.findIndex(
      (row) => row.reviewState !== "reviewed"
    );

    if (unreviewedIndex >= 0) {
      setError(`Review sibling row ${unreviewedIndex + 1} before saving.`);
      return;
    }

    const unresolvedIndex = activeRows.findIndex((row) => !row.selectedMode);

    if (unresolvedIndex >= 0) {
      setError(
        `Resolve the possible matches for sibling row ${unresolvedIndex + 1}.`
      );
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/events/family-reunions/${encodeURIComponent(
          familyId
        )}/quick-add/bulk-siblings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            referencePersonId,
            parentIds: selectedParentIds,
            siblings: activeRows.map((row) => ({
              clientRowId: row.rowId,
              mode: row.selectedMode,
              existingPersonId:
                row.selectedMode === "use_existing"
                  ? row.selectedExistingPersonId
                  : null,
              fullName:
                row.selectedMode === "create_new"
                  ? row.fullName.trim()
                  : null,
              sex: row.sex,
              locationText: row.locationText.trim() || null,
              locationScope: null,
              locationBucket: null,
            })),
          }),
        }
      );

      const data = (await response.json()) as WriteResponse;

      if (!response.ok || !data.success) {
        setError(
          data.error || "Sibling Entry failed. No siblings were saved."
        );
        return;
      }

      await onSaved(
        data.message ||
          `${data.processedCount || activeRows.length} siblings added successfully.`
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Sibling Entry failed. No siblings were saved."
      );
    } finally {
      setSaving(false);
    }
  }

  const branchName = branchLabel(biologicalParents, selectedParentIds);
  const blockedForNoParents = !loadingParents && biologicalParents.length === 0;
  const blockedForTooManyParents = !loadingParents && biologicalParents.length > 2;

  return (
    <div className="mt-5 border-t border-slate-800 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-teal-300">
            Add Siblings of {referencePersonName}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Choose which recorded biological parent branch the siblings share,
            review possible duplicate identities, then save the entire sibling
            batch atomically.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={saving || reviewing}
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-black text-slate-300 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {loadingParents ? (
        <p className="mt-4 text-xs text-slate-400">
          Loading recorded biological parents...
        </p>
      ) : null}

      {blockedForNoParents ? (
        <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950/20 p-4">
          <p className="text-sm font-black text-amber-200">
            No biological parent is recorded for {referencePersonName}.
          </p>
          <p className="mt-2 text-xs leading-5 text-amber-100/80">
            Add at least one biological parent first. Sibling Entry only uses
            parent branches that are already proven on the selected person.
          </p>
        </div>
      ) : null}

      {blockedForTooManyParents ? (
        <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950/20 p-4">
          <p className="text-sm font-black text-amber-200">
            More than two biological parents are recorded.
          </p>
          <p className="mt-2 text-xs leading-5 text-amber-100/80">
            Review this branch in Advanced Genealogy Editor before adding
            siblings.
          </p>
        </div>
      ) : null}

      {!loadingParents && biologicalParents.length > 0 && biologicalParents.length <= 2 ? (
        <>
          <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
              Known Biological Parents
            </p>
            <p className="mt-2 text-sm font-black text-white">
              {biologicalParents.map((parent) => parent.fullName).join(" + ")}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {biologicalParents.length} biological parent
              {biologicalParents.length === 1 ? "" : "s"} recorded for the
              selected person.
            </p>
          </div>

          <div className="mt-4">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">
              Siblings Belong to Which Parent Branch?
            </p>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              Both parents means full siblings on the recorded branch. Choosing
              one parent allows a half-sibling branch. When two parents are
              recorded, no branch is selected automatically.
            </p>

            <div className="mt-3 grid gap-2">
              {biologicalParents.length === 2 ? (
                <button
                  type="button"
                  onClick={() =>
                    chooseBranch(biologicalParents.map((parent) => parent.id))
                  }
                  className={`rounded-xl border p-3 text-left ${
                    selectedParentIds.length === 2
                      ? "border-teal-300 bg-teal-950/20"
                      : "border-slate-700 bg-slate-900"
                  }`}
                >
                  <p className="text-sm font-black text-white">
                    {biologicalParents[0].fullName} + {biologicalParents[1].fullName}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Full-sibling branch: both recorded biological parents.
                  </p>
                </button>
              ) : null}

              {biologicalParents.map((parent) => {
                const selected =
                  selectedParentIds.length === 1 &&
                  selectedParentIds[0] === parent.id;

                return (
                  <button
                    key={parent.id}
                    type="button"
                    onClick={() => chooseBranch([parent.id])}
                    className={`rounded-xl border p-3 text-left ${
                      selected
                        ? "border-amber-300 bg-amber-950/20"
                        : "border-slate-700 bg-slate-900"
                    }`}
                  >
                    <p className="text-sm font-black text-white">
                      {parent.fullName} only
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Half-sibling branch through {parent.fullName}.
                    </p>
                  </button>
                );
              })}
            </div>

            {biologicalParents.length === 2 &&
            selectedParentIds.length === 0 ? (
              <div className="mt-3 rounded-xl border border-amber-700 bg-amber-950/20 p-3">
                <p className="text-xs font-black text-amber-200">
                  Choose the sibling branch before reviewing or saving.
                </p>
                <p className="mt-1 text-[11px] leading-5 text-amber-100/80">
                  Select both parents for full siblings, or select exactly one
                  parent for a half-sibling branch.
                </p>
              </div>
            ) : null}
          </div>

          {selectedParentIds.length > 0 ? (
            <div className="mt-3 rounded-xl border border-emerald-800 bg-emerald-950/20 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-300">
                Siblings Being Added To
              </p>
              <p className="mt-2 text-sm font-black text-white">
                {branchName}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {referenceGeneration
                  ? `Generation remains graph-derived relative to the current root; these siblings should resolve beside Generation ${referenceGeneration} when that branch is reachable.`
                  : "Generation remains graph-derived after saving; no generation value is stored by this form."}
              </p>
            </div>
          ) : null}

          <div className="mt-4 space-y-4">
            {rows.map((row, rowIndex) => {
              const exactMatches = row.candidateReviews.filter(
                (review) =>
                  normalizedName(review.candidate.fullName) ===
                  normalizedName(row.fullName)
              );

              return (
                <div
                  key={row.rowId}
                  className="rounded-2xl border border-slate-700 bg-slate-900 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-black text-white">
                      Sibling {rowIndex + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeRow(row.rowId)}
                      className="text-xs font-black text-red-300"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label>
                      <span className="text-xs font-bold text-slate-300">
                        Full Name
                      </span>
                      <input
                        value={row.fullName}
                        onChange={(event) =>
                          updateRow(
                            row.rowId,
                            { fullName: event.target.value },
                            true
                          )
                        }
                        placeholder="Sibling's full name"
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                      />
                    </label>

                    <label>
                      <span className="text-xs font-bold text-slate-300">Sex</span>
                      <select
                        value={row.sex}
                        onChange={(event) =>
                          updateRow(row.rowId, { sex: event.target.value })
                        }
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                      >
                        <option value="unspecified">Unspecified</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </label>

                    <label>
                      <span className="text-xs font-bold text-slate-300">
                        Detailed Place
                      </span>
                      <input
                        value={row.locationText}
                        onChange={(event) =>
                          updateRow(row.rowId, {
                            locationText: event.target.value,
                          })
                        }
                        placeholder="Optional"
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white"
                      />
                    </label>
                  </div>

                  {row.reviewState === "error" ? (
                    <div className="mt-3 rounded-lg border border-red-800 bg-red-950/30 p-3 text-xs text-red-200">
                      {row.error}
                    </div>
                  ) : null}

                  {row.reviewState === "reviewed" && row.fullName.trim() ? (
                    <div className="mt-4">
                      {row.candidateReviews.length === 0 ? (
                        <div className="rounded-lg border border-emerald-800 bg-emerald-950/20 p-3 text-xs text-emerald-200">
                          No possible existing person was found. This row is
                          ready to create a new sibling.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {exactMatches.length > 0 ? (
                            <div className="rounded-lg border border-red-800 bg-red-950/20 p-3 text-xs text-red-200">
                              Exact-name record found. New-person creation is
                              disabled for this sibling row. Use a safe existing
                              record below or review the relationship in Advanced
                              Genealogy Editor.
                            </div>
                          ) : null}

                          {row.candidateReviews.map((review) => {
                            const candidate = review.candidate;
                            const canUse = canUseCandidate(review);
                            const selected =
                              row.selectedMode === "use_existing" &&
                              row.selectedExistingPersonId === candidate.candidateId;

                            return (
                              <div
                                key={`${row.rowId}:${candidate.candidateId}`}
                                className={`rounded-lg border p-3 ${
                                  selected
                                    ? "border-emerald-300 bg-emerald-950/20"
                                    : canUse
                                    ? "border-slate-700 bg-slate-950"
                                    : "border-amber-800 bg-amber-950/20"
                                }`}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-black text-white">
                                      {candidate.fullName}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-400">
                                      {candidate.locationBucket ||
                                        candidate.locationText ||
                                        "Location not recorded"}
                                    </p>
                                    {candidate.matchScope === "OTHER_FAMILY" ? (
                                      <p className="mt-1 text-[11px] text-amber-300">
                                        Other family: {candidate.organizationalFamily?.name || "Unassigned"}
                                      </p>
                                    ) : null}
                                  </div>
                                  <span className="text-[11px] text-slate-500">
                                    {Math.round(candidate.similarityScore * 100)}% match
                                  </span>
                                </div>

                                {normalizedName(candidate.fullName) !==
                                normalizedName(row.fullName) ? (
                                  <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900 p-3">
                                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                                      Possible Same Person
                                    </p>
                                    <p className="mt-1 text-[11px] leading-5 text-slate-400">
                                      Compare the existing record with the name
                                      you entered. Suffixes and middle names can
                                      identify a genuinely different person.
                                    </p>
                                  </div>
                                ) : null}

                                <p className={`mt-2 text-xs ${canUse ? "text-emerald-300" : "text-amber-300"}`}>
                                  {candidateStatusText(review)}
                                </p>

                                {canUse ? (
                                  <button
                                    type="button"
                                    onClick={() => selectExisting(row.rowId, review)}
                                    className="mt-3 rounded-lg bg-emerald-300 px-3 py-2 text-xs font-black text-slate-950"
                                  >
                                    {selected
                                      ? "Existing Sibling Selected"
                                      : `Use Existing ${candidate.fullName}`}
                                  </button>
                                ) : null}
                              </div>
                            );
                          })}

                          {exactMatches.length === 0 ? (
                            <button
                              type="button"
                              onClick={() => confirmDifferentPerson(row.rowId)}
                              className={`rounded-lg border px-3 py-2 text-xs font-black ${
                                row.selectedMode === "create_new"
                                  ? "border-teal-300 bg-teal-950/20 text-teal-200"
                                  : "border-amber-500 text-amber-200"
                              }`}
                            >
                              {row.selectedMode === "create_new"
                                ? "New Sibling Selected"
                                : "This Is A Different Person"}
                            </button>
                          ) : null}
                        </div>
                      )}

                      {row.selectedMode ? (
                        <p className="mt-3 text-xs font-bold text-emerald-300">
                          Ready: {row.selectedMode === "create_new"
                            ? "create a new sibling"
                            : "use the selected existing person"}.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={addRow}
              disabled={rows.length >= 20}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-black text-slate-300 disabled:opacity-40"
            >
              Add Another Row
            </button>

            <button
              type="button"
              onClick={() => void reviewRows()}
              disabled={reviewing || selectedParentIds.length === 0}
              className="rounded-lg border border-teal-400 bg-teal-400/10 px-3 py-2 text-xs font-black text-teal-200 disabled:opacity-50"
            >
              {reviewing ? "Reviewing Siblings..." : "Review Siblings"}
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded-lg border border-red-800 bg-red-950/30 p-3 text-xs text-red-200">
              {error}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void saveSiblings()}
            disabled={saving || reviewing || selectedParentIds.length === 0}
            className="mt-4 w-full rounded-xl bg-teal-300 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-50"
          >
            {saving
              ? "Saving Siblings..."
              : `Save Siblings to ${branchName || "Selected Parent Branch"}`}
          </button>
        </>
      ) : null}
    </div>
  );
}
