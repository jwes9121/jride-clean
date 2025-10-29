// app/admin/users/page.tsx
import React from "react";
import UsersManager from "./users-manager";

export const dynamic = "force-dynamic";

export default function AdminUsersPage() {
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Manage Users &amp; Roles</h1>
      <UsersManager />
    </div>
  );
}
