'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="secondary"
      onClick={() => {
        void fetch('/api/v1/auth/logout', { method: 'POST' }).then(() => {
          router.replace('/login');
          router.refresh();
        });
      }}
    >
      Sign out
    </button>
  );
}
