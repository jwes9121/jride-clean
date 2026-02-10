'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error('App error:', error);

  return (
    <html>
      <body style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h2>Something went wrong</h2>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#b91c1c' }}>
          {error?.message}
        </pre>
        <button
          onClick={() => reset()}
          style={{
            marginTop: 12,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #ccc',
          }}
        >
          Retry
        </button>
      </body>
    </html>
  );
}
