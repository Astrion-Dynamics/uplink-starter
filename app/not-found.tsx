import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-readable px-gutter py-section">
      <h1 className="font-heading text-h1">Page not found</h1>
      <p className="mt-4 text-text-muted">This page does not exist, or it has moved.</p>
      <p className="mt-8">
        <Link href="/" className="text-link hover:text-link-hover">
          Go to the home page
        </Link>
      </p>
    </main>
  );
}
