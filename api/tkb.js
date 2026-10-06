// Vercel serverless function: lấy file TKB từ website trường (Google Sheets đã xuất bản)
// /api/tkb            -> tuần mới nhất
// /api/tkb?url=<link> -> link bài của trường hoặc link Google Sheets
// Lưu ý: gọi web trường bằng fetch trơn (không giả User-Agent, không proxy) - đúng cách bản cũ từng chạy được.
const BASE = 'http://thptchauphong.agg.edu.vn';
const toXlsx = u => u.replace(/\/pubhtml.*$/, '/pub?output=xlsx').replace(/\/pub\?(?!output=xlsx).*$/, '/pub?output=xlsx');

const why = e => (e && e.cause ? ' [' + (e.cause.code || e.cause.message) + ']' : '');
const getText = async u => {
  try {
    const r = await fetch(u);
    if (!r.ok) throw new Error('Trang trường trả về ' + r.status);
    return await r.text();
  } catch (e) {
    throw new Error(String(e.message || e) + why(e));
  }
};

// Lấy mã 2PACX-... của Google Sheets trong HTML (chịu được các kiểu viết URL khác nhau)
const findIds = html => {
  const t = html.replace(/&amp;/g, '&').replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/%2F/gi, '/');
  return [...new Set((t.match(/spreadsheets\/d\/e\/(2PACX-[\w-]+)/g) || []).map(x => x.split('/').pop()))];
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
      if (!ids.length) throw new Error('Bài không có link Google Sheets');

      // Nhiều link thì chọn file có sheet "sáng" và "chiều"; không có thì lấy link đầu tiên
      let pickId = ids[0];
      if (ids.length > 1) {
        for (const id of ids) {
          try {
            const h = await (await fetch('https://docs.google.com/spreadsheets/d/e/' + id + '/pubhtml')).text();
            if (/s[áa]ng/i.test(h) && /chi[ềe]u/i.test(h)) { pickId = id; break; }
          } catch (e) {}
        }
      }
      sheetUrl = 'https://docs.google.com/spreadsheets/d/e/' + pickId + '/pubhtml';
      source = postUrl;
    }

    const r = await fetch(toXlsx(sheetUrl));
    if (!r.ok) throw new Error('Google trả về ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    res.setHeader('X-Source', encodeURI(source));
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) + why(e) });
  }
};
