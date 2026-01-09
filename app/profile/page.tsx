'use client';

import Image from 'next/image';

export default function ProfilePage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">My Profile</h1>

      {/* ✅ Replaced <img> with <Image> */}
      <Image
        src="/profile.png"
        alt="Profile picture"
        width={120}
        height={120}
        className="rounded-full"
      />
    </div>
  );
}


