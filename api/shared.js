// Vercel serverless function: lưu / đọc TKB dùng chung cho mọi người
// GET  /api/shared -> 200 {label,time,b64} | 204 nếu chưa có
// POST /api/shared  body JSON {label, b64} -> lưu bản mới (ghi đè bản cũ)
// Hỗ trợ: REDIS_URL (redis:// hoặc rediss://) hoặc Upstash REST (..._REST_API_URL / ..._REST_API_TOKEN)
const names = Object.keys(process.env);
const pick = re => names.find(n => re.test(n) && !/READ_ONLY/i.test(n));
const REDIS_URL = process.env.REDIS_URL || process.env[pick(/(^|_)REDIS_URL$/i)] || '';
const REST_URL = process.env[pick(/REST_API_URL$|REST_URL$/i)] || '';
const REST_TOKEN = process.env[pick(/REST_API_TOKEN$|REST_TOKEN$/i)] || '';
const KEY = 'tkb:current';
const MAX_B64 = 3 * 1024 * 1024;

let client;
const getClient = () => {
  if (!client) {
    const Redis = require('ioredis');
    client = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, connectTimeout: 8000 });
    client.on('error', () => {});
  }
  return client;
};

const redis = async cmd => {
  if (REDIS_URL) {
    const [op, ...args] = cmd;
    return getClient()[op.toLowerCase()](...args);
  }
  if (!REST_URL || !REST_TOKEN) throw new Error('Không thấy biến Redis. Các biến liên quan: ' + (names.filter(n => /KV|REDIS|UPSTASH|REST|STORAGE/i.test(n)).join(', ') || 'không có'));
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'Redis ' + r.status);
  return j.result;
};

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET') {
      const v = await redis(['GET', KEY]);
      if (!v) return res.status(204).end();
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(v);
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      const b64 = body && body.b64;
      if (typeof b64 !== 'string' || !b64 || b64.length > MAX_B64) throw new Error('Dữ liệu không hợp lệ hoặc quá lớn');
      if (Buffer.from(b64.slice(0, 8), 'base64').toString('latin1').slice(0, 2) !== 'PK') throw new Error('Không phải file Excel');
      const time = Date.now();
      const label = String((body && body.label) || '').slice(0, 200);
      await redis(['SET', KEY, JSON.stringify({ label, time, b64 })]);
      return res.status(200).json({ ok: true, time });
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
