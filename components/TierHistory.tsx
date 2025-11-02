"use client";

import { useEffect, useState } from "react";

export default function TierHistory() {
  const [history, setHistory] = useState<string[]>([]);

  const loadTierHistory = async () => {
    // Mock load for now
    setHistory(["Joined Bronze", "Upgraded to Silver", "Now Gold"]);
  };

  useEffect(() => {
    loadTierHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-4 bg-white rounded-xl shadow">
      <h3 className="font-bold mb-2">Tier History</h3>
      <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
        {history.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    </div>
  );
}



