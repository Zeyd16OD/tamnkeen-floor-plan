export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const TOPIC = String(process.env.NTFY_TOPIC || '').trim();
  const NOTIFY_TOKEN = String(process.env.NOTIFY_API_TOKEN || '').trim();

  if (!TOPIC || !NOTIFY_TOKEN) {
    return res.status(404).json({ error: 'Not found' });
  }

  const providedToken = String(req.headers['x-notify-token'] || '').trim();
  if (!providedToken || providedToken !== NOTIFY_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'missing body' });

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
