/** @component UplinkPage */
export default function UplinkPage() {
  // Set UPLINK_HOST only to point the site at another Uplink (a preview or local one).
  const uplinkHost = process.env.UPLINK_HOST || 'https://www.uplinkcms.com';

  return (
    <main style={{ width: '100%', height: '100%' }}>
      <iframe
        title="Uplink"
        src={uplinkHost}
        referrerPolicy="strict-origin-when-cross-origin"
        allow="clipboard-read; clipboard-write; fullscreen"
        style={{ display: 'block', width: '100%', height: '100%', border: 0 }}
      />
    </main>
  );
}
