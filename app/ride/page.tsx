'use client'

import { useEffect, useState } from 'react'

type Booking = {
  booking_code: string
  status: string
  pickup_lat: number
  pickup_lng: number
  driver_lat?: number
  driver_lng?: number
  proposed_fare?: number
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export default function RidePage() {
  const [booking, setBooking] = useState<Booking | null>(null)
  const [distance, setDistance] = useState<number | null>(null)
  const [eta, setEta] = useState<number | null>(null)

  useEffect(() => {
    const fetchBooking = async () => {
      const res = await fetch('/api/public/passenger/booking')
      const data = await res.json()
      if (data?.booking) setBooking(data.booking)
    }

    fetchBooking()
    const interval = setInterval(fetchBooking, 3000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (
      booking?.driver_lat &&
      booking?.driver_lng &&
      booking?.pickup_lat &&
      booking?.pickup_lng
    ) {
      const d = haversine(
        booking.driver_lat,
        booking.driver_lng,
        booking.pickup_lat,
        booking.pickup_lng
      )
      setDistance(d)

      // avg speed 25km/h
      const etaMin = (d / 25) * 60
      setEta(Math.round(etaMin))
    }
  }, [booking])

  const statusSteps = [
    'requested',
    'assigned',
    'on_the_way',
    'arrived',
    'on_trip',
    'completed',
  ]

  const currentIndex = statusSteps.indexOf(booking?.status || '')

  return (
    <div className="p-4 max-w-xl mx-auto">

      {/* STATUS BAR */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {statusSteps.map((s, i) => (
          <div
            key={s}
            className={`text-center p-2 rounded text-xs ${
              i === currentIndex
                ? 'bg-green-500 text-white'
                : 'bg-gray-700 text-gray-300'
            }`}
          >
            {s.replaceAll('_', ' ')}
          </div>
        ))}
      </div>

      {/* DRIVER DISTANCE */}
      {distance && (
        <div className="mb-2 text-sm">
          Driver distance: {distance.toFixed(2)} km
        </div>
      )}

      {/* ETA */}
      {eta && (
        <div className="mb-4 text-sm">
          ETA: {eta} min
        </div>
      )}

      {/* FARE */}
      {booking?.proposed_fare && (
        <div className="text-lg font-bold mb-4">
          PHP {booking.proposed_fare.toFixed(2)}
        </div>
      )}

      {/* ACTIONS */}
      {booking?.status === 'completed' && (
        <div className="space-y-2">
          <button className="w-full bg-green-500 p-3 rounded">
            Book Again
          </button>
          <button className="w-full bg-gray-600 p-3 rounded">
            View Receipt
          </button>
        </div>
      )}
    </div>
  )
}