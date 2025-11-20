"use client";

import { AssignNearestButton } from "@/components/AssignNearestButton";

export default function DispatchAssignPage() {
  return (
    <main className="p-4 md:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">
              Dispatch – Assign Nearest Driver
            </h1>
            <p className="text-sm text-gray-600">
              This page assigns the nearest online driver to the latest
              pending booking using{" "}
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
                /api/rides/assign-nearest/latest
              </code>
              .
            </p>
          </div>
        </header>

        <section className="border rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium">
            Assign Latest Pending Ride
          </h2>
          <p className="text-xs text-gray-600">
            Click the button below to call the backend and assign the nearest
            online driver to the **oldest** pending booking. The result or
            error will be shown under the button.
          </p>

          <AssignNearestButton />
        </section>

        <section className="border rounded-lg p-4 space-y-2">
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Notes
          </h3>
          <ul className="text-xs text-gray-600 list-disc pl-4 space-y-1">
            <li>
              If you see{" "}
              <code className="bg-gray-100 px-1 rounded">
                No assignment: no_pending_booking
              </code>
              , there are no rides with{" "}
              <code className="bg-gray-100 px-1 rounded">status =
              'pending'</code>{" "}
              or <code className="bg-gray-100 px-1 rounded">status =
              'searching'</code> and{" "}
              <code className="bg-gray-100 px-1 rounded">
                assigned_driver_id is null
              </code>
              .
            </li>
            <li>
              If you see{" "}
              <code className="bg-gray-100 px-1 rounded">
                no_online_drivers
              </code>
              , it means there are pending bookings but no drivers with{" "}
              <code className="bg-gray-100 px-1 rounded">
                driver_locations.status = 'online'
              </code>
              .
            </li>
            <li>
              On success, it will show the{" "}
              <code className="bg-gray-100 px-1 rounded">
                assigned_driver_id
              </code>{" "}
              and the{" "}
              <code className="bg-gray-100 px-1 rounded">
                booking_code
              </code>
              .
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
