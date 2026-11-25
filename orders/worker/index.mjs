import { erpApi, erpErrorResponse, erpReadStatements, erpReadResult, erpRestoreStatements } from './erp.mjs';

const headers = {'cache-control':'no-store','x-content-type-options':'nosniff'};
const json = (data, status = 200) => Response.json(data, {status, headers});
const typeFields = {
  customers: ['id','name','phone','address','created_at'],
  extracts: ['id','title','source','data','created_at'],
  customer_extracts: ['id','customer_id','extract_id','quantity','linked_on','note']
};

class InputError extends Error {}

function validate(value, condition, message) {
  if (!condition(value)) throw new InputError(message);
  return value;
}

function string(value, max, label, required = false) {
  return validate(value, text => typeof text === 'string' && text.length <= max &&
    (!required || text.trim().length > 0), label + ' 항목을 확인하세요.');
}

function id(value) {
  return validate(value, text => typeof text === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(text), '기록 ID가 올바르지 않습니다.');
}

function isoDate(value) {
  return validate(value, text => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) &&
    !Number.isNaN(Date.parse(text)) && new Date(text).toISOString().slice(0,10) === text, '연결 날짜를 확인하세요.');
}

function timestamp(value) {
  return validate(value, text => typeof text === 'string' && text.length <= 30 && !Number.isNaN(Date.parse(text)), '등록 날짜가 올바르지 않습니다.');
}

function object(value) {
  return validate(value, item => item && typeof item === 'object' && !Array.isArray(item), '데이터 형식을 확인하세요.');
}

function row(table, input, restoring = false) {
  object(input);
  const key = restoring || input.id ? id(input.id) : crypto.randomUUID();
  const created_at = () => restoring ? timestamp(input.created_at) : new Date().toISOString();
  if (table === 'customers') return {
    id:key, name:string(input.name, 100, '고객 이름', true).trim(),
    phone:string(input.phone ?? '', 80, '연락처').trim(),
    address:string(input.address ?? '', 500, '주소').trim(), created_at:created_at()
  };
  if (table === 'extracts') {
    const fields = object(input.data);
    const {__erp_png: png, ...metadata} = fields;
    if (Object.hasOwn(fields,'__erp_png') && (typeof png !== 'string' || png.length > 1048576 ||
        !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(png) || png.length % 4 !== 0 ||
        atob(png.slice(0,24)).slice(12,16) !== 'IHDR')) {
      throw new InputError('768KiB 이하의 올바른 PNG 파일을 선택하세요.');
    }
    const data = JSON.stringify(fields);
    if (!Object.keys(fields).length || new TextEncoder().encode(JSON.stringify(metadata)).length > 40000) {
      throw new InputError('추출 기록은 비어 있지 않은 JSON 객체여야 하며 한 건에 40KB까지 저장할 수 있습니다.');
    }
    return {id:key,title:string(input.title,240,'추출 기록 이름',true).trim(),
      source:string(input.source ?? '',260,'출처').trim(),data,created_at:created_at()};
  }
  const quantity = input.quantity ?? null;
  if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000)) {
    throw new InputError('수량은 1에서 1,000,000 사이의 정수로 입력하세요.');
  }
  return {id:key,customer_id:id(input.customer_id),extract_id:id(input.extract_id),quantity,
    linked_on:isoDate(input.linked_on),note:string(input.note ?? '',1000,'메모').trim()};
}

function rows(table, list, restoring = false) {
  if (!Array.isArray(list)) throw new InputError('목록 형식이 올바르지 않습니다.');
  const seen = new Set();
  return list.map(item => {
    const record = row(table,item,restoring);
    if (seen.has(record.id)) throw new InputError('파일에 중복된 기록 ID가 있습니다.');
    seen.add(record.id);
    return record;
  });
}

function inserts(db, owner, table, records, ignore = false) {
  const fields = typeFields[table];
  const values = fields.map(field => "json_extract(value, '$." + field + "')").join(',');
  const suffix = ignore ? ' WHERE true ON CONFLICT(owner_id,id) DO NOTHING' : '';
  const statement = 'INSERT INTO ' + table + ' (owner_id,' + fields.join(',') +
    ') SELECT ?,' + values + ' FROM json_each(?)' + suffix;
  const encoder = new TextEncoder();
  const chunks = [];
  let current = [], bytes = 0;
  for (const record of records) {
    const value = JSON.stringify(record);
    const size = encoder.encode(value).length + 1;
    if (current.length && bytes + size > 120000) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(value);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks.map(chunk => db.prepare(statement).bind(owner,'[' + chunk.join(',') + ']'));
}

async function runBatch(db, statements) {
  if (!statements.length) return [];
  return db.batch(statements);
}

async function read(db, owner, includeOrders = false) {
  const tables = Object.keys(typeFields);
  const ordering = ['created_at DESC, id','created_at DESC, id','linked_on DESC, id'];
  const statements = tables.map((table,index) => db.prepare(
    'SELECT ' + typeFields[table].join(',') + ' FROM ' + table + ' WHERE owner_id=? ORDER BY ' + ordering[index]
  ).bind(owner));
  if (includeOrders) statements.push(...erpReadStatements(db,owner));
  const result = await runBatch(db,statements);
  const records = Object.fromEntries(tables.map((table,index) => [table,result[index].results]));
  records.extracts = records.extracts.map(record => ({...record,data:JSON.parse(record.data)}));
  return includeOrders ? {...records,...erpReadResult(result.slice(tables.length))} : records;
}

async function payload(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new InputError('JSON 요청이 필요합니다.');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 8_000_000) throw new InputError('한 번에 8MB까지 불러올 수 있습니다.');
  try { return object(JSON.parse(text)); }
  catch { throw new InputError('JSON 형식을 확인하세요.'); }
}

async function api(request, db, path, owner) {
  if (request.method === 'GET' && path === '/api/records') return json(await read(db,owner));
  if (request.method === 'GET' && path === '/api/backup') {
    const records = await read(db,owner,true);
    return json({format:'customer-extract-links',version:2,exported_at:new Date().toISOString(),...records});
  }
  if (request.method === 'GET' && path === '/api/erp') return erpApi(request,db,owner,path);
  if (request.method === 'POST') {
    if (request.headers.get('origin') !== new URL(request.url).origin) return json({error:'요청 출처를 확인할 수 없습니다.'},403);
    const body = await payload(request);
    if (path === '/api/shot-extract') {
      const record = row('extracts', {
        id: body.id, title: body.filename.replace(/\.png$/, ''), source: body.filename,
        data: { __shot_filename: body.filename },
      });
      await runBatch(db, inserts(db, owner, 'extracts', [record], true));
      return json({id: record.id});
    }
    if (path.startsWith('/api/erp/')) {
      const result = await erpApi(request,db,owner,path,body);
      if (result) return result;
    }
    if (path === '/api/customers') {
      const customer = row('customers',body);
      if (body.id) {
        const result = await db.prepare('UPDATE customers SET name=?,phone=?,address=? WHERE owner_id=? AND id=?')
          .bind(customer.name,customer.phone,customer.address,owner,customer.id).run();
        if (!result.meta.changes) return json({error:'고객 기록을 찾을 수 없습니다.'},404);
      } else {
        await runBatch(db,inserts(db,owner,'customers',[customer]));
      }
      return json({id:customer.id});
    }
    if (path === '/api/extracts') {
      const records = rows('extracts',body.records);
      if (!records.length) throw new InputError('저장할 추출 데이터가 없습니다.');
      await runBatch(db,inserts(db,owner,'extracts',records));
      return json({count:records.length});
    }
    if (path === '/api/links') {
      const record = row('customer_extracts',body);
      await runBatch(db,inserts(db,owner,'customer_extracts',[record]));
      return json({id:record.id});
    }
    if (path === '/api/unlink') {
      await db.prepare('DELETE FROM customer_extracts WHERE owner_id=? AND id=?').bind(owner,id(body.id)).run();
      return json({ok:true});
    }
    if (path === '/api/restore') {
      if (body.format !== 'customer-extract-links' || ![1,2].includes(body.version)) {
        throw new InputError('버전 1 또는 2의 고객·추출 데이터 백업 파일을 선택하세요.');
      }
      const statements = Object.keys(typeFields).flatMap(table =>
        inserts(db,owner,table,rows(table,body[table],true),true));
      if (body.version === 2) statements.push(...erpRestoreStatements(db,owner,body));
      const result = await runBatch(db,statements);
      return json({count:result.reduce((count,entry) => count + (entry.meta.changes ?? 0),0)});
    }
  }
  return json({error:'요청을 찾을 수 없습니다.'},404);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return new Response(null,{status:404,headers});
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) return json({error:'로그인 후 이용하세요.'},401);
    if (!env.DB) return json({error:'데이터 저장소에 연결할 수 없습니다.'},503);
    try {
      return await api(request,env.DB,path,owner);
    } catch (error) {
      if (error instanceof InputError) return json({error:error.message},400);
      const erpError = erpErrorResponse(error);
      if (erpError) return erpError;
      if (/FOREIGN KEY/i.test(error.message)) return json({error:'연결할 고객 또는 추출 기록을 찾을 수 없습니다. 백업의 연결 관계도 확인하세요.'},409);
      console.error('Database operation failed',path,error.name);
      return json({error:'저장 작업을 완료하지 못했습니다. 잠시 후 다시 시도하세요.'},500);
    }
  }
};
