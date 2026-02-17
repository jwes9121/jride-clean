'use client';

import { useEffect, useState } from 'react';
import supabase from "@/lib/supabaseClient";

export default function DispatcherPerformanceOverview() {
  const [performance, setPerformance] = useState<any[]>([]);

  const loadPerformanceOverview = async () => {
    const { data } = await supabase.from('dispatcher_logs').select('*');
    setPerformance(data || []);
  };

  useEffect(() => {
    loadPerformanceOverview();
  }, [loadPerformanceOverview]); // Ã¢Å“â€¦ dependency added

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold">Dispatcher Overview</h2>
      <pre>{JSON.stringify(performance, null, 2)}</pre>
    </div>
  );
}



