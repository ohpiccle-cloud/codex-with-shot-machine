const MAX_PNG = 16 * 1024 * 1024;
const PNG_PART_SIZE = 512 * 1024;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const filenamePattern = /^(\d{4}-\d{2}-\d{2})_(\d+)\.png$/;
const namespaceURL = Uint8Array.from([0x6b,0xa7,0xb8,0x11,0x9d,0xad,0x11,0xd1,0x80,0xb4,0x00,0xc0,0x4f,0xd4,0x30,0xc8]);
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

function encodeImagePart(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(text);
}

export async function orderExtractId(filename) {
  const name = new TextEncoder().encode('shot-history/' + filename);
  const bytes = new Uint8Array(namespaceURL.length + name.length);
  bytes.set(namespaceURL);
  bytes.set(name, namespaceURL.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes)).slice(0, 16);
  hash[6] = (hash[6] & 15) | 80;
  hash[8] = (hash[8] & 63) | 128;
  const hex = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export async function findShot(db, owner, filename) {
  const match = typeof filename === 'string' && filenamePattern.exec(filename);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  return db.prepare('SELECT id, title, notes FROM shot_history WHERE owner_id=? AND day=? AND number=?')
    .bind(owner, match[1], Number(match[2])).first();
}

function shotFilename(day, number) {
  return day + '_' + String(number).padStart(3, '0') + '.png';
}

async function saveShot(request, db, owner, day, filename = null) {
  const number = filename === null ? null : Number(filenamePattern.exec(filename)?.[2]);
  const date = Date.parse(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date)
      || new Date(date).toISOString().slice(0, 10) !== day
      || request.headers.get('Content-Type') !== 'image/png'
      || Number(request.headers.get('Content-Length')) > MAX_PNG
      || (filename !== null && (!Number.isSafeInteger(number) || number < 1
        || filename !== shotFilename(day, number)))) {
    return json({error:'추출 날짜와 PNG 파일을 확인해 주세요.'}, 400);
  }
  const started = request.headers.get('X-Shot-Started-At');
  const timestamp = started === null ? Date.now() : Date.parse(started);
  let notes, title;
  try {
    const raw = request.headers.get('X-Shot-Notes');
    notes = raw === null ? null : decodeURIComponent(raw);
    const rawTitle = filename === null ? null : request.headers.get('X-Shot-Title');
    title = rawTitle === null ? null : decodeURIComponent(rawTitle).trim() || null;
    if (!Number.isFinite(timestamp) || (notes?.length ?? 0) > 1000
        || (title?.length ?? 0) > 120 || (title && /[\r\n]/.test(title))) throw new Error();
  } catch {
    return json({error:'추출 시간이나 메모를 확인해 주세요.'}, 400);
  }
  const image = new Uint8Array(await request.arrayBuffer());
  if (image.length > MAX_PNG || !pngSignature.every((byte, index) => image[index] === byte)) {
    return json({error:'16MB 이하의 PNG 이미지가 필요합니다.'}, 400);
  }
  const conflict = () => json({error:'같은 날짜와 번호의 기록이 이미 있습니다.'},409);
  if (filename && await findShot(db,owner,filename)) return conflict();
  const id = crypto.randomUUID();
  const header = filename ? db.prepare(
    'INSERT INTO shot_history(owner_id,id,day,number,started_at,notes,title) VALUES (?,?,?,?,?,?,?)'
  ).bind(owner,id,day,number,timestamp / 1000,notes,title) : db.prepare(
    'INSERT INTO shot_history(owner_id,id,day,number,started_at,notes) ' +
    'SELECT ?,?,?,COALESCE(MAX(number),0)+1,?,? FROM shot_history WHERE owner_id=? AND day=?'
  ).bind(owner, id, day, timestamp / 1000, notes, owner, day);
  const statements = [header];
  for (let offset = 0; offset < image.length; offset += PNG_PART_SIZE) {
    const bytes = image.subarray(offset, offset + PNG_PART_SIZE);
    statements.push(db.prepare('INSERT INTO shot_image_parts VALUES (?,?,?,?)')
      .bind(owner, id, offset / PNG_PART_SIZE, encodeImagePart(bytes)));
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (filename && await findShot(db,owner,filename)) return conflict();
    throw error;
  }
  const saved = await db.prepare('SELECT number FROM shot_history WHERE owner_id=? AND id=?').bind(owner,id).first();
  return json({ path: shotFilename(day, saved.number), number: saved.number }, 201);
}

export async function historyApi(request, db, owner, url) {
  const { pathname: path } = url;
  if (request.method === 'POST' && (request.headers.get('Origin') !== url.origin
      || request.headers.get('X-Shot-Save') !== '1')) {
    return json({error:'요청 출처를 확인할 수 없습니다.'}, 403);
  }
  if (path === '/api/extractions') {
    if (request.method === 'POST') return saveShot(request, db, owner, url.searchParams.get('date') ?? '');
    if (request.method === 'GET') {
      const {results} = await db.prepare(
        'SELECT day, number, started_at, title FROM shot_history WHERE owner_id=? ORDER BY day DESC, started_at DESC, number DESC'
      ).bind(owner).all();
      return json({records: await Promise.all(results.map(async row => {
        const filename = shotFilename(row.day, row.number);
        return {filename, date: row.day, number: row.number, timestamp: row.started_at, title: row.title,
          url: '/api/extractions/files/' + filename, orderExtractId: await orderExtractId(filename)};
      }))});
    }
  }
  if (path === '/api/extractions/import' && request.method === 'POST') {
    const filename = url.searchParams.get('filename') ?? '';
    return saveShot(request,db,owner,filenamePattern.exec(filename)?.[1] ?? '',filename);
  }
  const route = /^\/api\/extractions\/(files|title|notes)\/([^/]+)$/.exec(path);
  if (!route) return json({error:'요청을 찾을 수 없습니다.'}, 404);
  const [, field, filename] = route;
  const shot = await findShot(db, owner, filename);
  if (!shot) return json({error:'추출 기록을 찾을 수 없습니다.'}, 404);
  if (field === 'files' && request.method === 'GET') {
    const {results} = await db.prepare(
      'SELECT data FROM shot_image_parts WHERE owner_id=? AND shot_id=? ORDER BY position'
    ).bind(owner, shot.id).all();
    const stream = new ReadableStream({
      start(controller) {
        for (const {data} of results) controller.enqueue(Uint8Array.from(atob(data), char => char.charCodeAt(0)));
        controller.close();
      },
    });
    return new Response(stream, {headers:{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if (field !== 'files' && request.method === 'GET') return json({[field]: shot[field]});
  if (field !== 'files' && request.method === 'POST') {
    let value;
    try {
      const raw = await request.text();
      if (raw.length > 8192) throw new Error();
      value = JSON.parse(raw);
      if (typeof value !== 'string' || value.length > (field === 'title' ? 120 : 1000)) throw new Error();
      if (field === 'title') {
        value = value.trim() || null;
        if (value && /[\r\n]/.test(value)) throw new Error();
      }
    } catch {
      return json({error:'제목 또는 메모의 형식과 길이를 확인해 주세요.'}, 400);
    }
    await db.prepare('UPDATE shot_history SET ' + field + '=? WHERE owner_id=? AND id=?').bind(value,owner,shot.id).run();
    return json({[field]: value});
  }
  return json({error:'지원하지 않는 요청입니다.'}, 405);
}
