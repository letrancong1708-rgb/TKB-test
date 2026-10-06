// Vercel serverless function: lấy file TKB từ website trường (Google Sheets đã xuất bản)
// /api/tkb            -> tuần mới nhất
// /api/tkb?url=<link> -> link bài của trường hoặc link Google Sheets
const BASE = 'http://thptchauphong.agg.edu.vn';
const HEAD = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'vi-VN,vi;q=0.9'
};
const toXlsx = u => u.replace(/\/pubhtml.*$/, '/pub?output=xlsx').replace(/\/pub\?(?!output=xlsx).*$/, '/pub?output=xlsx');

// Giải mã các kiểu viết URL hay gặp trong HTML
const norm = s => s
  .replace(/&amp;/g, '&')
  .replace(/&#0*47;|&#x0*2f;/gi, '/')
  .replace(/\\u002f/gi, '/')
  .replace(/\\\//g, '/')
  .replace(/%2F/gi, '/')
  .replace(/%3A/gi, ':');

// Lấy tất cả mã 2PACX-... của Google Sheets trong HTML
const findIds = html => [...new Set(
  (norm(html).match(/spreadsheets\/d\/e\/(2PACX-[\w-]+)/g) || []).map(x => x.split('/').pop())
)];

const getText = async u => {
  const r = await fetch(u, { headers: HEAD });
  if (!r.ok) throw new Error('Trang trường trả về ' + r.status);
  return r.text();
};

module.exports = async (req, res) => {
  try {
    let target = req.query && req.query.url ? String(req.query.url).trim() : '';
    let host = '';
    if (target) {
      try { host = new URL(target).hostname; } catch (e) { throw new Error('Link không hợp lệ'); }
      if (host !== 'thptchauphong.agg.edu.vn' && host !== 'docs.google.com') {
        throw new Error('Chỉ hỗ trợ link của trường hoặc Google Sheets');
      }
    }

    let sheetUrl = '', source = '';
    if (host === 'docs.google.com') {
      sheetUrl = target; source = target;
    } else {
      let postUrl = target;
      if (!postUrl) {
        const list = await getText(BASE + '/thoi-khoa-bieu');
        const re = /href="(?:https?:\/\/thptchauphong\.agg\.edu\.vn)?(\/thoi-khoa-bieu\/[^"#?]+-(\d+))"/gi;
        let best = null, m;
        while ((m = re.exec(list))) {
          const id = Number(m[2]);
          if (!best || id > best.id) best = { id, path: m[1] };
        }
        if (!best) throw new Error('Không tìm thấy bài thời khóa biểu');
        postUrl = BASE + best.path;
      }

      const post = await getText(postUrl);
      const ids = findIds(post);
      if (!ids.length) {
        throw new Error('Không thấy mã Google Sheets trong bài (HTML dài ' + post.length + ' ký tự)');
      }

      // Chọn file có sheet "sáng" và "chiều" (file TKB lớp); không có thì lấy mã cuối
      let pickId = '';
      for (const id of ids) {
        try {
          const h = await getText('https://docs.google.com/spreadsheets/d/e/' + id + '/pubhtml');
          if (/s[áa]ng/i.test(h) && /chi[ềe]u/i.test(h)) { pickId = id; break; }
        } catch (e) {}
      }
      if (!pickId) pickId = ids[ids.length - 1];

      sheetUrl = 'https://docs.google.com/spreadsheets/d/e/' + pickId + '/pubhtml';
      source = postUrl;
    }

    const r = await fetch(toXlsx(sheetUrl), { headers: HEAD });
    if (!r.ok) throw new Error('Google trả về ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    res.setHeader('X-Source', encodeURI(source));
    res.status(200).send(buf);
  } catch (e) {
    const why = e.cause ? ' [' + (e.cause.code || e.cause.message) + ']' : '';
    res.status(502).json({ error: String(e.message || e) + why });
  }
};
