import * as React from "react";
import UsersManager from "./users-manager";
export const dynamic = "force-dynamic";
export default function AdminUsersPage(): JSX.Element {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Manage Users & Roles</h1>
      <UsersManager />
    </div>
  );
}

