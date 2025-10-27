// app/page.tsx

export default function HomePage() {
  return (
    <main className="p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-4">J-Ride Dispatch</h1>

      <p className="text-sm text-gray-700 mb-4">
        Welcome to the J-Ride Dispatch console.
      </p>

      <ul className="text-sm text-blue-600 underline space-y-2">
        <li>
          <a href="/auth/signin">Sign in</a>
        </li>
        <li>
          <a href="/dispatch">Go to Dispatch Dashboard</a>
        </li>
      </ul>
    </main>
  );
}
