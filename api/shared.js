// Vercel serverless function: lưu / đọc TKB dùng chung cho mọi người
// GET  /api/shared -> 200 {label,time,b64} | 204 nếu chưa có
// POST /api/shared  body JSON {label, b64} -> lưu bản mới (ghi đè bản cũ)
// Cần Upstash Redis (Vercel > Storage > Marketplace > Upstash Redis), biến môi trường tự được thêm.
// Tự dò tên biến môi trường (Vercel có thể thêm tiền tố khác nhau, vd KV_, UPSTASH_REDIS_, STORAGE_...)
const names = Object.keys(process.env);
const pick = re => names.find(n => re.test(n) && !/READ_ONLY/i.test(n));
const URL_ = process.env[pick(/REST_API_URL$|REST_URL$/i)] || '';
const TOKEN = process.env[pick(/REST_API_TOKEN$|REST_TOKEN$/i)] || '';
const KEY = 'tkb:current';
const MAX_B64 = 3 * 1024 * 1024; // ~2.2MB file xlsx

const redis = async cmd => {
  if (!URL_ || !TOKEN) throw new Error('Không thấy biến Redis. Các biến liên quan đang có: ' + (names.filter(n => /KV|REDIS|UPSTASH|REST|STORAGE/i.test(n)).join(', ') || 'không có biến nào'));
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
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
      // file xlsx là file zip: 2 byte đầu "PK"
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
