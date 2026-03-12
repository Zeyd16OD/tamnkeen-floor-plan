export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { title, body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'missing body' });

  const TOPIC = 'tamkeen-expo-2026-admin-zeyd';

  try {
    await fetch('https://ntfy.sh/' + TOPIC, {
      method: 'POST',
      headers: {
        'Title':        title || 'Tamkeen Expo',
        'Priority':     'high',
        'Tags':         'bell',
        'Content-Type': 'text/plain; charset=utf-8'
      },
      body: String(body)
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
