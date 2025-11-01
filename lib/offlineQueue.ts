/**
 * Very small offline queue for client-side fetch-like work.
 * Persists to localStorage, flushes when back online. No-ops during SSR.
 */
type Job = {
  id: string;
  url: string;
  method?: string;
  body?: any;
  headers?: Record<string, string>;
};

const KEY = "jr_offline_queue_v1";

function safeLS() {
  try { if (typeof window === "undefined") return null; return window.localStorage; }
  catch { return null; }
}

function load(): Job[] {
  const ls = safeLS();
  if (!ls) return [];
  try { return JSON.parse(ls.getItem(KEY) || "[]"); } catch { return []; }
}

function save(list: Job[]) {
  const ls = safeLS();
  if (!ls) return;
  try { ls.setItem(KEY, JSON.stringify(list)); } catch {}
}

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

async function run(job: Job) {
  await fetch(job.url, {
    method: job.method || "POST",
    headers: { "content-type": "application/json", ...(job.headers || {}) },
    body: job.body ? JSON.stringify(job.body) : undefined,
    keepalive: true,
  });
}

export async function flush() {
  if (typeof window === "undefined") return;
  const list = load();
  if (!list.length) return;
  const next: Job[] = [];
  for (const j of list) {
    try { await run(j); } catch { next.push(j); }
  }
  save(next);
}

export function enqueue(job: Omit<Job, "id">) {
  if (typeof window === "undefined") return;
  const list = load();
  list.push({ id: uuid(), ...job });
  save(list);
}

function initOnce() {
  if (typeof window === "undefined") return;
  if ((window as any).__jr_offline_queue_init) return;
  (window as any).__jr_offline_queue_init = true;
  flush();
  window.addEventListener("online", flush);
}
initOnce();

export default { enqueue, flush };