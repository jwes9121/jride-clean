import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });

  const { data, error } = await supabase
    .from('dispatch_rides_v1')
    .select('*')
    .order('driver_updated_at', { ascending: false });

  if (error) {
    console.error('ACTIVE_TRIPS_DB_ERROR', error);
    return Response.json({ error }, { status: 500 });
  }

  return Response.json({ data });
}
