const PROJECT_ID = String(process.env.FIREBASE_PROJECT_ID || '').trim();
const DB_NAME = String(process.env.FIREBASE_DB_NAME || 'default').trim() || 'default';
const API_KEY = String(process.env.FIREBASE_API_KEY || '').trim();
const ADMIN_TOKEN = String(process.env.ADMIN_PANEL_TOKEN || '').trim();
const NTFY_TOPIC = String(process.env.NTFY_TOPIC || '').trim();

const FIRESTORE_BASE =
  'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
  '/databases/' + DB_NAME + '/documents';

const SETTINGS_DOC_ID = '__publicMapDisplay';
const LOCKED_STANDS = new Set();
const STATUS_ALLOWED = new Set(['pending', 'confirmed', 'rejected', 'cancelled']);
const PAGE_SIZE = 300;

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.json(payload);
}

function getField(fields, key) {
  const f = fields && fields[key];
  if (!f) return null;
  if (f.stringValue !== undefined) return f.stringValue;
  if (f.integerValue !== undefined) return f.integerValue;
  if (f.booleanValue !== undefined) return f.booleanValue;
  if (f.nullValue !== undefined) return null;
  return null;
}

function sanitizeText(value, maxLen) {
  return String(value || '').trim().slice(0, maxLen);
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function requireAdmin(req, res) {
  const providedToken = String(req.headers['x-admin-token'] || '').trim();
  if (!providedToken || providedToken !== ADMIN_TOKEN) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function sendReservationNotification({ standId, type, tier, name, company }) {
  if (!NTFY_TOPIC) return;

  const isSponsoring = type === 'sponsoring';
  const standInfo = isSponsoring
    ? 'Sponsoring (' + (tier || '') + ')'
    : 'Stand ' + (standId || '');
  const body = standInfo + ' | ' + (name || '') + (company ? ' - ' + company : '');

  try {
    await fetch('https://ntfy.sh/' + encodeURIComponent(NTFY_TOPIC), {
      method: 'POST',
      headers: {
        Title: 'Tamkeen Expo - New reservation',
        Priority: 'high',
        Tags: 'bell',
        'Content-Type': 'text/plain; charset=utf-8'
      },
      body
    });
  } catch {
    // Ignore notification delivery failures; reservation is already stored.
  }
}

async function firestoreRequest(path, { method = 'GET', query = {}, body } = {}) {
  const url = new URL(FIRESTORE_BASE + path);
  url.searchParams.set('key', API_KEY);

  Object.entries(query).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
    } else if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), options);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function listReservations() {
  return firestoreRequest('/reservations', {
    method: 'GET',
    query: { pageSize: PAGE_SIZE }
  });
}

function mapReservationDoc(doc) {
  const id = String(doc.name || '').split('/').pop();
  const fields = doc.fields || {};

  return {
    id,
    standId: getField(fields, 'standId'),
    type: getField(fields, 'type'),
    tier: getField(fields, 'tier'),
    name: getField(fields, 'name'),
    company: getField(fields, 'company'),
    phone: getField(fields, 'phone'),
    email: getField(fields, 'email'),
    status: getField(fields, 'status') || 'pending',
    timestamp: getField(fields, 'timestamp') || doc.createTime
  };
}

async function handlePublicStatuses(res) {
  const listRes = await listReservations();
  if (!listRes.ok) {
    return sendJson(res, listRes.status, { error: 'Failed to load statuses' });
  }

  const standStatuses = {};
  const standCompanies = {};

  (listRes.data.documents || []).forEach((doc) => {
    const fields = doc.fields || {};
    const standId = getField(fields, 'standId');
    const status = getField(fields, 'status');

    if (!standId || LOCKED_STANDS.has(standId)) return;
    if (status === 'rejected' || status === 'cancelled') return;

    if (!standStatuses[standId] || status === 'confirmed') {
      standStatuses[standId] = status === 'confirmed' ? 'reserved' : 'pending';
      standCompanies[standId] = getField(fields, 'company') || '';
    }
  });

  LOCKED_STANDS.forEach((standId) => {
    standStatuses[standId] = 'locked';
    standCompanies[standId] = '';
  });

  return sendJson(res, 200, { standStatuses, standCompanies });
}

async function handlePublicSetting(res) {
  const settingRes = await firestoreRequest('/reservations/' + SETTINGS_DOC_ID);

  if (settingRes.status === 404) {
    return sendJson(res, 200, { showCompanyNames: false });
  }
  if (!settingRes.ok) {
    return sendJson(res, settingRes.status, { error: 'Failed to load map setting' });
  }

  const showCompanyNames = !!getField(settingRes.data.fields || {}, 'showCompanyNames');
  return sendJson(res, 200, { showCompanyNames });
}

async function handleCreateReservation(req, res) {
  const body = parseBody(req);

  const standId = sanitizeText(body.standId, 20);
  const type = sanitizeText(body.type, 40);
  const tier = sanitizeText(body.tier, 40);
  const name = sanitizeText(body.name, 120);
  const company = sanitizeText(body.company, 120);
  const phone = sanitizeText(body.phone, 40);
  const email = sanitizeText(body.email, 120);

  if (!name || !company || !phone || !email || !type) {
    return sendJson(res, 400, { error: 'Missing required fields' });
  }

  if (standId && LOCKED_STANDS.has(standId)) {
    return sendJson(res, 403, { error: 'This stand is sponsor-only' });
  }

  if (type === 'sponsoring') {
    if (tier !== 'officiel' && tier !== 'standard') {
      return sendJson(res, 400, { error: 'Invalid sponsoring tier' });
    }
  } else if (!standId) {
    return sendJson(res, 400, { error: 'Missing stand id' });
  }

  if (standId) {
    const listRes = await listReservations();
    if (!listRes.ok) {
      return sendJson(res, listRes.status, { error: 'Failed to verify stand availability' });
    }

    const hasConflict = (listRes.data.documents || []).some((doc) => {
      const fields = doc.fields || {};
      const sId = getField(fields, 'standId');
      const status = getField(fields, 'status');
      return sId === standId && status !== 'rejected' && status !== 'cancelled';
    });

    if (hasConflict) {
      return sendJson(res, 409, { error: 'Stand is no longer available' });
    }
  }

  const createRes = await firestoreRequest('/reservations', {
    method: 'POST',
    body: {
      fields: {
        standId: { stringValue: standId || '' },
        type: { stringValue: type },
        tier: { stringValue: tier || '' },
        name: { stringValue: name },
        company: { stringValue: company },
        phone: { stringValue: phone },
        email: { stringValue: email },
        status: { stringValue: 'pending' }
      }
    }
  });

  if (!createRes.ok) {
    const msg = createRes.data && createRes.data.error && createRes.data.error.message;
    return sendJson(res, createRes.status, { error: msg || 'Failed to create reservation' });
  }

  await sendReservationNotification({ standId, type, tier, name, company });

  return sendJson(res, 200, { ok: true });
}

async function handleAdminList(req, res) {
  if (!requireAdmin(req, res)) return;

  const listRes = await listReservations();
  if (!listRes.ok) {
    return sendJson(res, listRes.status, { error: 'Failed to load reservations' });
  }

  const reservations = (listRes.data.documents || [])
    .map(mapReservationDoc)
    .filter((r) => r.status !== 'cancelled' && r.type !== 'system-setting' && r.id !== SETTINGS_DOC_ID)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return sendJson(res, 200, { reservations });
}

async function handleAdminUpdateStatus(req, res) {
  if (!requireAdmin(req, res)) return;

  const body = parseBody(req);
  const docId = sanitizeText(body.docId, 120);
  const status = sanitizeText(body.status, 20);

  if (!docId || !/^[A-Za-z0-9_-]+$/.test(docId)) {
    return sendJson(res, 400, { error: 'Invalid reservation id' });
  }
  if (!STATUS_ALLOWED.has(status)) {
    return sendJson(res, 400, { error: 'Invalid status' });
  }

  const patchRes = await firestoreRequest('/reservations/' + encodeURIComponent(docId), {
    method: 'PATCH',
    query: { 'updateMask.fieldPaths': 'status' },
    body: {
      fields: {
        status: { stringValue: status }
      }
    }
  });

  if (!patchRes.ok) {
    const msg = patchRes.data && patchRes.data.error && patchRes.data.error.message;
    return sendJson(res, patchRes.status, { error: msg || 'Failed to update reservation status' });
  }

  return sendJson(res, 200, { ok: true });
}

async function handleAdminSetPublicSetting(req, res) {
  if (!requireAdmin(req, res)) return;

  const body = parseBody(req);
  const showCompanyNames = !!body.showCompanyNames;

  const patchRes = await firestoreRequest('/reservations/' + SETTINGS_DOC_ID, {
    method: 'PATCH',
    query: {
      'updateMask.fieldPaths': ['showCompanyNames', 'status', 'type']
    },
    body: {
      fields: {
        showCompanyNames: { booleanValue: showCompanyNames },
        status: { stringValue: 'cancelled' },
        type: { stringValue: 'system-setting' }
      }
    }
  });

  if (!patchRes.ok) {
    const msg = patchRes.data && patchRes.data.error && patchRes.data.error.message;
    return sendJson(res, patchRes.status, { error: msg || 'Failed to update map setting' });
  }

  return sendJson(res, 200, { ok: true });
}

export default async function handler(req, res) {
  if (!PROJECT_ID || !API_KEY || !ADMIN_TOKEN) {
    return sendJson(res, 500, { error: 'Server configuration is incomplete' });
  }

  const action = String((req.query && req.query.action) || '').trim();

  try {
    if (req.method === 'GET' && action === 'publicStatuses') return handlePublicStatuses(res);
    if (req.method === 'GET' && action === 'publicSetting') return handlePublicSetting(res);
    if (req.method === 'POST' && action === 'createReservation') return handleCreateReservation(req, res);

    if (req.method === 'GET' && action === 'adminList') return handleAdminList(req, res);
    if (req.method === 'PATCH' && action === 'adminUpdateStatus') return handleAdminUpdateStatus(req, res);
    if (req.method === 'PATCH' && action === 'adminSetPublicSetting') return handleAdminSetPublicSetting(req, res);

    return sendJson(res, 404, { error: 'Route not found' });
  } catch (err) {
    return sendJson(res, 500, { error: 'Internal server error' });
  }
}
