// app/page.tsx

export default function HomePage() {
  return (
    <main className="p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-4">J-Ride Dispatch</h1>
      <p className="text-sm text-gray-700">
        Welcome. Please sign in at <code>/auth/signin</code> and then open{" "}
        <code>/dispatch</code>.
      </p>
    </main>
  );
}
