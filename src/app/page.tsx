import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>Keyhook-agent</h1>
      <ul>
        <li>
          <Link href="/dashboard">Property manager dashboard</Link>
        </li>
        <li>
          <Link href="/simulator">Tenant / tradie simulator</Link>
        </li>
      </ul>
    </main>
  );
}
