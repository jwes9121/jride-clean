// lib/roles.ts
export type AppRole = "admin" | "dispatcher" | "driver" | "user";

function parseList(v?: string | null) {
  return (v ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

const ADMIN = new Set(parseList(process.env.ADMIN_EMAILS));
const DISPATCHER = new Set(parseList(process.env.DISPATCHER_EMAILS));
const DRIVER = new Set(parseList(process.env.DRIVER_EMAILS));

export function inferRoleByEmail(email?: string | null): AppRole {
  const e = (email ?? "").toLowerCase();
  if (!e) return "user";
  if (ADMIN.has(e)) return "admin";
  if (DISPATCHER.has(e)) return "dispatcher";
  if (DRIVER.has(e)) return "driver";
  return "user";
}

export function homeFor(role: AppRole): string {
  switch (role) {
    case "admin": return "/admin";
    case "dispatcher": return "/dispatch";
    case "driver": return "/driver";
    default: return "/"; // regular user
  }
}
