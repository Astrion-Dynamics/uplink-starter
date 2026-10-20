/** @component UplinkPage */
export default function UplinkPage() {
  const uplinkHost = process.env.UPLINK_HOST;

  if (!uplinkHost) {
    throw new Error('Missing UPLINK_HOST. Add it to your .env.local file.');
  }

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
