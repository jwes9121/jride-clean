"use client";

export default function ServicesSection() {
  return (
    <section className="p-8 bg-gray-50 rounded-2xl">
      <h2 className="text-2xl font-bold mb-4">Our Services</h2>

      <div className="space-y-4">
        <div className="bg-white p-4 rounded-xl shadow">
          <h3 className="font-semibold">Ride</h3>
          <p>{"Fast, safe, and affordable rides around town."}</p>
        </div>

        <div className="bg-white p-4 rounded-xl shadow">
          <h3 className="font-semibold">Delivery</h3>
          <p>{"Quick food and parcel deliveries to your doorstep."}</p>
        </div>

        <div className="bg-white p-4 rounded-xl shadow">
          <h3 className="font-semibold">Errands</h3>
          <p>{"Trusted helpers for your everyday tasks."}</p>
        </div>
      </div>
    </section>
  );
}


