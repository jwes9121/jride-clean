import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MANILA_TZ = "Asia/Manila";
const ALLOWED_WINDOWS = new Set([7, 30, 90]);

type AnyRow = Record<string, any>;

type DailyRow = {
  date: string;
  registered: number;
  verified_from_cohort: number;
  cumulative_registered: number;
};

function count(value: unknown) {
  return Number(value || 0).toLocaleString("en-PH");
}

function pct(value: number) {
  return value.toFixed(2) + "%";
}

function manilaDateKey(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "unknown";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDateKey(dateKey: string, deltaDays: number) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function formatDateKey(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const d = new Date(`${dateKey}T00:00:00+08:00`);
  return d.toLocaleDateString("en-PH", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString("en-PH", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function fetchPaged(makeQuery: () => any, pageSize = 1000) {
  const rows: AnyRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await makeQuery().range(from, from + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    const page = Array.isArray(result.data) ? result.data : [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function listAllAuthUsers(admin: ReturnType<typeof supabaseAdmin>) {
  const users: AnyRow[] = [];
  const perPage = 1000;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const batch = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);
    if (batch.length < perPage) return users;
  }
  throw new Error("AUTH_USER_PAGINATION_LIMIT_REACHED");
}

function StatCard(props: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {props.title}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-950">{props.value}</div>
      {props.sub ? <div className="mt-1 text-xs text-slate-500">{props.sub}</div> : null}
    </div>
  );
}

export default async function PassengerGrowthPage({
  searchParams,
}: {
  searchParams?: { days?: string | string[] };
}) {
  const rawDays = Array.isArray(searchParams?.days) ? searchParams?.days[0] : searchParams?.days;
  const requestedDays = Number(rawDays || 30);
  const days = ALLOWED_WINDOWS.has(requestedDays) ? requestedDays : 30;
  const admin = supabaseAdmin({ noStore: true });

  const [authUsers, passengerProfiles, approvedVerificationRows, testIdentityRows] =
    await Promise.all([
      listAllAuthUsers(admin),
      fetchPaged(() => admin.from("passenger_profiles").select("user_id,created_at")),
      fetchPaged(() =>
        admin
          .from("passenger_verifications")
          .select("user_id,status,admin_reviewed_at")
          .eq("status", "approved_admin")
      ),
      fetchPaged(() =>
        admin
          .from("analytics_test_identities")
          .select("entity_id,entity_type,active")
          .eq("entity_type", "passenger")
          .eq("active", true)
      ),
    ]);

  const profileIds = new Set(
    passengerProfiles.map((row) => String(row.user_id || "")).filter(Boolean)
  );
  const dummyPassengerIds = new Set(
    testIdentityRows.map((row) => String(row.entity_id || "")).filter(Boolean)
  );

  const productionUsers = authUsers
    .filter((user) => profileIds.has(String(user.id || "")))
    .filter((user) => !dummyPassengerIds.has(String(user.id || "")))
    .filter((user) => Boolean(user.created_at));

  const productionUserIds = new Set(productionUsers.map((user) => String(user.id)));
  const verifiedUserIds = new Set(
    approvedVerificationRows
      .map((row) => String(row.user_id || ""))
      .filter((id) => id && productionUserIds.has(id))
  );

  const registeredUsers = productionUsers.length;
  const verifiedUsers = verifiedUserIds.size;
  const verificationRate = registeredUsers > 0 ? (verifiedUsers / registeredUsers) * 100 : 0;

  const dailyAll: Record<string, { registered: number; verified_from_cohort: number }> = {};
  const monthlyAll: Record<string, { registered: number; verified_from_cohort: number }> = {};
  let firstRegistration: string | null = null;
  let latestRegistration: string | null = null;

  for (const user of productionUsers) {
    const createdAt = String(user.created_at || "");
    const dateKey = manilaDateKey(createdAt);
    if (dateKey === "unknown") continue;
    const monthKey = dateKey.slice(0, 7);
    const isVerified = verifiedUserIds.has(String(user.id));

    if (!dailyAll[dateKey]) dailyAll[dateKey] = { registered: 0, verified_from_cohort: 0 };
    dailyAll[dateKey].registered += 1;
    if (isVerified) dailyAll[dateKey].verified_from_cohort += 1;

    if (!monthlyAll[monthKey]) monthlyAll[monthKey] = { registered: 0, verified_from_cohort: 0 };
    monthlyAll[monthKey].registered += 1;
    if (isVerified) monthlyAll[monthKey].verified_from_cohort += 1;

    if (!firstRegistration || createdAt < firstRegistration) firstRegistration = createdAt;
    if (!latestRegistration || createdAt > latestRegistration) latestRegistration = createdAt;
  }

  const today = manilaDateKey(new Date());
  const startDate = shiftDateKey(today, -(days - 1));
  const previousStartDate = shiftDateKey(startDate, -days);
  const previousEndDate = shiftDateKey(startDate, -1);

  let baseCumulative = productionUsers.filter((user) => {
    const key = manilaDateKey(String(user.created_at || ""));
    return key !== "unknown" && key < startDate;
  }).length;

  const dailyRows: DailyRow[] = [];
  let cursor = startDate;
  let runningCumulative = baseCumulative;
  while (cursor <= today) {
    const bucket = dailyAll[cursor] || { registered: 0, verified_from_cohort: 0 };
    runningCumulative += bucket.registered;
    dailyRows.push({
      date: cursor,
      registered: bucket.registered,
      verified_from_cohort: bucket.verified_from_cohort,
      cumulative_registered: runningCumulative,
    });
    cursor = shiftDateKey(cursor, 1);
  }

  const selectedRegistered = dailyRows.reduce((sum, row) => sum + row.registered, 0);
  const selectedVerifiedFromCohort = dailyRows.reduce(
    (sum, row) => sum + row.verified_from_cohort,
    0
  );

  let previousRegistered = 0;
  for (const [dateKey, bucket] of Object.entries(dailyAll)) {
    if (dateKey >= previousStartDate && dateKey <= previousEndDate) {
      previousRegistered += bucket.registered;
    }
  }

  const periodChangePct =
    previousRegistered > 0
      ? ((selectedRegistered - previousRegistered) / previousRegistered) * 100
      : null;

  const monthlyRows = Object.entries(monthlyAll)
    .map(([month, values]) => ({ month, ...values }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const topSpikeDates = Object.entries(dailyAll)
    .map(([date, values]) => ({ date, ...values }))
    .sort((a, b) => b.registered - a.registered || b.date.localeCompare(a.date))
    .slice(0, 10);

  const maxMonthly = Math.max(1, ...monthlyRows.map((row) => row.registered));

  return (
    <main className="mx-auto min-h-screen max-w-[1600px] bg-slate-50 p-4 text-slate-900 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Passenger Growth</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Production passenger registrations use the Auth account creation time in Asia/Manila.
            Analytics V3 dummy passenger identities are excluded. Verified means currently admin-approved.
          </p>
        </div>
        <form className="flex items-center gap-2" method="get">
          <select
            name="days"
            defaultValue={String(days)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="7">Last 7 Manila days</option>
            <option value="30">Last 30 Manila days</option>
            <option value="90">Last 90 Manila days</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            Apply
          </button>
        </form>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Registered passengers"
          value={count(registeredUsers)}
          sub={`${count(dummyPassengerIds.size)} Analytics V3 dummy passengers excluded`}
        />
        <StatCard
          title="Verified passengers"
          value={count(verifiedUsers)}
          sub="Current admin-approved production passengers"
        />
        <StatCard
          title="Verification rate"
          value={pct(verificationRate)}
          sub="Verified divided by registered production passengers"
        />
        <StatCard
          title={`New registrations - ${days} days`}
          value={count(selectedRegistered)}
          sub={
            periodChangePct == null
              ? `Previous ${days} days: ${count(previousRegistered)}`
              : `${periodChangePct >= 0 ? "+" : ""}${periodChangePct.toFixed(1)}% vs previous ${days} days (${count(previousRegistered)})`
          }
        />
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-3">
        <StatCard
          title="Verified from selected cohorts"
          value={count(selectedVerifiedFromCohort)}
          sub="Registered in the selected window and verified now"
        />
        <StatCard
          title="First production registration"
          value={formatDateTime(firstRegistration)}
        />
        <StatCard
          title="Latest production registration"
          value={formatDateTime(latestRegistration)}
        />
      </section>

      <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <div className="font-bold">Ad-effectiveness interpretation</div>
        <p className="mt-1">
          Registration spikes are an acquisition signal, not proof that an ad caused the increase.
          Compare campaign start, stop and budget-change dates with the dated registration rows below.
          A future campaign log can make this attribution more direct.
        </p>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold">Daily Registration Growth</h2>
              <p className="text-xs text-slate-500">
                {formatDateKey(startDate)} to {formatDateKey(today)}. Zero-registration dates are retained.
              </p>
            </div>
          </div>
          <div className="mt-3 max-h-[680px] overflow-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-2">Registration date</th>
                  <th className="p-2 text-right">New registered</th>
                  <th className="p-2 text-right">Verified now from cohort</th>
                  <th className="p-2 text-right">Cumulative registered</th>
                </tr>
              </thead>
              <tbody>
                {[...dailyRows].reverse().map((row) => (
                  <tr key={row.date} className="border-t border-slate-100">
                    <td className="p-2 font-medium">{formatDateKey(row.date)}</td>
                    <td className="p-2 text-right font-semibold">{count(row.registered)}</td>
                    <td className="p-2 text-right">{count(row.verified_from_cohort)}</td>
                    <td className="p-2 text-right">{count(row.cumulative_registered)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold">Top Registration Spikes</h2>
          <p className="text-xs text-slate-500">Highest single-day production registrations, all time.</p>
          <div className="mt-3 space-y-2">
            {topSpikeDates.map((row, index) => (
              <div key={row.date} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">#{index + 1}</div>
                    <div className="font-semibold">{formatDateKey(row.date)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold">{count(row.registered)}</div>
                    <div className="text-xs text-slate-500">
                      {count(row.verified_from_cohort)} verified now
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold">Monthly Acquisition History</h2>
        <p className="text-xs text-slate-500">
          All production passenger registration cohorts. The current month is partial.
        </p>
        <div className="mt-4 space-y-3">
          {monthlyRows.map((row) => (
            <div key={row.month} className="grid gap-2 md:grid-cols-[100px_1fr_170px] md:items-center">
              <div className="text-sm font-semibold">{row.month}</div>
              <div className="h-7 overflow-hidden rounded bg-slate-100">
                <div
                  className="flex h-full items-center rounded bg-emerald-600 px-2 text-xs font-semibold text-white"
                  style={{ width: `${Math.max(3, (row.registered / maxMonthly) * 100)}%` }}
                >
                  {count(row.registered)}
                </div>
              </div>
              <div className="text-xs text-slate-600 md:text-right">
                {count(row.verified_from_cohort)} verified now from cohort
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500 shadow-sm">
        <div className="font-semibold text-slate-700">Data quality</div>
        <div className="mt-1">
          Registration source: auth.users.created_at, scoped to passenger_profiles. Verification source:
          passenger_verifications.status = approved_admin. Timezone: Asia/Manila. Dummy passengers excluded:
          {" "}{count(dummyPassengerIds.size)}.
        </div>
      </section>
    </main>
  );
}
