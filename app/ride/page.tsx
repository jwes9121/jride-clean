'use client'

import { useSearchParams } from 'next/navigation'
import TrackClient from './track/TrackClient'
import SimpleBookRide from './SimpleBookRide'

export default function RidePage() {
  const params = useSearchParams()
  const code = params.get('booking_code')

  // NO BOOKING â†’ SHOW BOOKING UI
  if (!code) {
    return (
      <div className="p-4">
        <SimpleBookRide />
      </div>
    )
  }

  // WITH BOOKING â†’ TRACK
  return (
    <div className="p-4">
      <TrackClient code={code} />
    </div>
  )
}
