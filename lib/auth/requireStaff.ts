import { auth } from "@/auth";

export type StaffRole = "admin" | "dispatcher";

export type AuthorizedStaff = {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
};

export type StaffAuthorizationResult =
  | {
      ok: true;
      staff: AuthorizedStaff;
    }
  | {
      ok: false;
      status: 401 | 403;
      error: "NOT_SIGNED_IN" | "FORBIDDEN";
    };

function normalizeRole(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export async function requireStaff(
  allowedRoles: readonly StaffRole[] = ["admin", "dispatcher"]
): Promise<StaffAuthorizationResult> {
  const session = await auth();
  const sessionUser = (session?.user || null) as
    | {
        id?: string | null;
        email?: string | null;
        name?: string | null;
        role?: string | null;
      }
    | null;

  if (!sessionUser) {
    return {
      ok: false,
      status: 401,
      error: "NOT_SIGNED_IN",
    };
  }

  const role = normalizeRole(sessionUser.role);
  const email = normalizeEmail(sessionUser.email);
  const id = String(sessionUser.id || "").trim();
  const name = String(sessionUser.name || "").trim();

  if (
    (role !== "admin" && role !== "dispatcher") ||
    !allowedRoles.includes(role as StaffRole)
  ) {
    return {
      ok: false,
      status: 403,
      error: "FORBIDDEN",
    };
  }

  return {
    ok: true,
    staff: {
      id,
      email,
      name,
      role: role as StaffRole,
    },
  };
}