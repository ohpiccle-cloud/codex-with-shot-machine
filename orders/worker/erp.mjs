const erpTables = {
  orders: {
    table: 'erp_orders',
    fields: ['id', 'order_no', 'customer_id', 'ordered_on', 'status', 'channel', 'address',
      'note', 'discount', 'shipping_fee', 'paid_amount', 'payment_method', 'revision', 'created_at'],
    order: 'ordered_on DESC, created_at DESC, id'
  },
  items: {
    table: 'erp_order_items',
    fields: ['id', 'order_id', 'position', 'name', 'sku', 'quantity', 'unit_price', 'note'],
    order: 'order_id, position, id'
  },
  shipments: {
    table: 'erp_shipments',
    fields: ['id', 'order_item_id', 'extract_id', 'quantity', 'shipped_on', 'note'],
    order: 'shipped_on DESC, id'
  },
  feedback: {
    table: 'erp_feedback',
    fields: ['id', 'order_id', 'score', 'recorded_on', 'note'],
    order: 'recorded_on DESC, id'
  },
  services: {
    table: 'erp_services',
    fields: ['id', 'order_id', 'order_item_id', 'status', 'opened_on', 'subject', 'note'],
    order: 'opened_on DESC, id'
  }
};

const erpOrderStatuses = ['접수', '처리 중', '완료', '취소'];
const erpServiceStatuses = ['접수', '진행 중', '완료', '취소'];

export class ErpInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function erpJson(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}
  });
}

export function erpErrorResponse(error) {
  if (error instanceof ErpInputError) return erpJson({error: error.message}, error.status);
  const message = String(error?.message ?? error);
  if (message.includes('ERP_SHIPMENT_LIMIT')) {
    return erpJson({error: '총 출고 수량은 주문 상품의 수량을 넘을 수 없습니다.'}, 409);
  }
  if (message.includes('ERP_ORDER_QUANTITY_LIMIT')) {
    return erpJson({error: '주문 수량은 이미 출고한 수량 이상이어야 합니다.'}, 409);
  }
  if (message.includes('ERP_ITEM_HAS_HISTORY')) {
    return erpJson({error: '출고 또는 A/S 이력이 연결된 상품은 주문에서 제거할 수 없습니다.'}, 409);
  }
  if (message.includes('ERP_ITEM_PRODUCT_LOCKED')) {
    return erpJson({error: '출고된 상품의 이름과 상품 코드는 변경할 수 없습니다.'}, 409);
  }
  if (message.includes('ERP_ORDER_CUSTOMER_LOCKED')) {
    return erpJson({error: '출고, 만족도 또는 A/S 이력이 있는 주문의 고객은 변경할 수 없습니다.'}, 409);
  }
  if (/foreign key/i.test(message)) {
    return erpJson({error: '참조한 고객, 추출 기록 또는 주문 상품을 찾을 수 없습니다.'}, 409);
  }
  return null;
}

function erpObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ErpInputError('기록 형식을 확인하세요.');
  }
  return value;
}

function erpId(value, label, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) {
    throw new ErpInputError(label + ' 항목을 확인하세요.');
  }
  return value;
}

function erpText(value, label, max, required = false) {
  if (!required && value == null) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new ErpInputError(label + ' 항목을 확인하세요.');
  }
  return value.trim();
}

function erpInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ErpInputError(label + ' 항목의 범위를 확인하세요.');
  }
  return value;
}

function erpMoney(value, label) {
  return erpInteger(value ?? 0, label, 0, 1_000_000_000_000);
}

function erpQuantity(value, label) {
  return erpInteger(value, label, 1, 1_000_000);
}

function erpDay(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new ErpInputError(label + ' 항목을 확인하세요.');
  }
  return value;
}

function erpStatus(value, options, label) {
  if (!options.includes(value)) throw new ErpInputError(label + ' 항목을 확인하세요.');
  return value;
}

function erpTimestamp(value) {
  if (typeof value !== 'string' || value.length > 30 || !Number.isFinite(Date.parse(value))) {
    throw new ErpInputError('등록 시각 항목을 확인하세요.');
  }
  return value;
}

function erpOrder(input, orderId) {
  return {
    id: orderId,
    customer_id: erpId(input.customer_id, '고객'),
    ordered_on: erpDay(input.ordered_on, '주문일'),
    status: erpStatus(input.status, erpOrderStatuses, '주문 상태'),
    channel: erpText(input.channel, '주문 채널', 100),
    address: erpText(input.address, '배송 주소', 500),
    note: erpText(input.note, '주문 메모', 1000),
    discount: erpMoney(input.discount, '할인 금액'),
    shipping_fee: erpMoney(input.shipping_fee, '배송비'),
    paid_amount: erpMoney(input.paid_amount, '결제 금액'),
    payment_method: erpText(input.payment_method, '결제 수단', 80)
  };
}

function erpItem(input, id, orderId, position) {
  erpObject(input);
  return {
    id,
    order_id: orderId,
    position,
    name: erpText(input.name, '상품 이름', 200, true),
    sku: erpText(input.sku, '상품 코드', 100),
    quantity: erpQuantity(input.quantity, '주문 수량'),
    unit_price: erpMoney(input.unit_price, '상품 단가'),
    note: erpText(input.note, '상품 메모', 1000)
  };
}

function erpRelated(kind, input, id) {
  if (kind === 'shipments') {
    return {
      id,
      order_item_id: erpId(input.order_item_id, '주문 상품'),
      extract_id: erpId(input.extract_id, '추출 기록', true),
      quantity: erpQuantity(input.quantity, '출고 수량'),
      shipped_on: erpDay(input.shipped_on, '출고일'),
      note: erpText(input.note, '출고 메모', 1000)
    };
  }
  if (kind === 'feedback') {
    return {
      id,
      order_id: erpId(input.order_id, '주문'),
      score: erpInteger(input.score, '만족도', 1, 5),
      recorded_on: erpDay(input.recorded_on, '평가일'),
      note: erpText(input.note, '만족도 메모', 1000)
    };
  }
  return {
    id,
    order_id: erpId(input.order_id, '주문'),
    order_item_id: erpId(input.order_item_id, '주문 상품', true),
    status: erpStatus(input.status, erpServiceStatuses, 'A/S 상태'),
    opened_on: erpDay(input.opened_on, 'A/S 접수일'),
    subject: erpText(input.subject, 'A/S 제목', 160, true),
    note: erpText(input.note, 'A/S 메모', 1000)
  };
}

export function erpReadStatements(db, owner) {
  return Object.values(erpTables).map(({table, fields, order}) => db.prepare(
    'SELECT ' + fields.join(',') + ' FROM ' + table + ' WHERE owner_id=? ORDER BY ' + order
  ).bind(owner));
}

export function erpReadResult(results) {
  return Object.fromEntries(Object.keys(erpTables).map((kind, index) => [kind, results[index].results]));
}

export async function readErp(db, owner) {
  return erpReadResult(await db.batch(erpReadStatements(db, owner)));
}

function erpInsert(db, owner, kind, record) {
  const {table, fields} = erpTables[kind];
  const args = fields.map(() => '?').join(',');
  return db.prepare('INSERT INTO ' + table + '(owner_id,' + fields.join(',') +
    ') VALUES (?,' + args + ')').bind(owner, ...fields.map(field => record[field]));
}

function erpUpdate(db, owner, kind, record) {
  const {table, fields} = erpTables[kind];
  const mutable = fields.filter(field => field !== 'id');
  return db.prepare('UPDATE ' + table + ' SET ' + mutable.map(field => field + '=?').join(',') +
    ' WHERE owner_id=? AND id=?').bind(...mutable.map(field => record[field]), owner, record.id);
}

function erpRowsJson(db, owner, kind, rows, where, tail, args = [], extraFields = []) {
  const {table, fields: standardFields} = erpTables[kind];
  const fields = [...standardFields, ...extraFields];
  const values = fields.map(field => "json_extract(value,'$." + field + "')").join(',');
  const sql = 'INSERT INTO ' + table + '(owner_id,' + fields.join(',') + ')' +
    ' SELECT ?,' + values + ' FROM json_each(?) WHERE ' + where + tail;
  const encoder = new TextEncoder();
  const statements = [];
  let chunk = [];
  let bytes = 0;
  function flush() {
    if (chunk.length) statements.push(db.prepare(sql).bind(owner, '[' + chunk.join(',') + ']', ...args));
    chunk = [];
    bytes = 0;
  }
  for (const row of rows) {
    const encoded = JSON.stringify(row);
    const size = encoder.encode(encoded).length + 1;
    if (bytes + size > 120_000) flush();
    chunk.push(encoded);
    bytes += size;
  }
  flush();
  return statements;
}

function erpOrderTotals(order, items) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const totalBeforeDiscount = subtotal + order.shipping_fee;
  if (!Number.isSafeInteger(totalBeforeDiscount)) throw new ErpInputError('주문 금액이 저장 가능한 범위를 초과합니다.');
  if (order.discount > totalBeforeDiscount) throw new ErpInputError('할인 금액은 상품 합계와 배송비의 합을 넘을 수 없습니다.');
}

async function erpSaveOrder(db, owner, input) {
  const existingId = erpId(input.id, '주문', true);
  const orderId = existingId ?? crypto.randomUUID();
  const order = erpOrder(input, orderId);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
    throw new ErpInputError('주문 상품을 1개 이상 100개 이하로 입력하세요.');
  }

  let knownItems = new Set();
  const saveRevision = existingId ? erpInteger(input.revision, '주문 변경 번호', 1, Number.MAX_SAFE_INTEGER - 1) : null;
  if (existingId) {
    const [header, lines] = await db.batch([
      db.prepare('SELECT revision FROM erp_orders WHERE owner_id=? AND id=?').bind(owner, existingId),
      db.prepare('SELECT id FROM erp_order_items WHERE owner_id=? AND order_id=?').bind(owner, existingId)
    ]);
    if (!header.results.length) throw new ErpInputError('수정할 주문을 찾을 수 없습니다.', 404);
    if (header.results[0].revision !== saveRevision) throw new ErpInputError('다른 화면에서 주문이 수정되었습니다. 새로고침 후 다시 시도하세요.', 409);
    knownItems = new Set(lines.results.map(item => item.id));
  }

  const seen = new Set();
  const items = input.items.map((raw, position) => {
    erpObject(raw);
    const existingItemId = erpId(raw.id, '주문 상품', true);
    if (existingItemId && !knownItems.has(existingItemId)) {
      throw new ErpInputError('현재 주문에 없는 상품 기록이 포함되어 있습니다.');
    }
    const itemId = existingItemId ?? crypto.randomUUID();
    if (seen.has(itemId)) throw new ErpInputError('같은 주문 상품이 두 번 포함되어 있습니다.');
    seen.add(itemId);
    return erpItem(raw, itemId, orderId, position);
  });
  erpOrderTotals(order, items);

  if (!existingId) {
    const orderTail = orderId.replace(/-/g, '').slice(0, 12).toUpperCase();
    order.order_no = 'OR-' + order.ordered_on.replace(/-/g, '') + '-' + orderTail;
    order.revision = 1;
    order.created_at = new Date().toISOString();
    await db.batch([
      erpInsert(db, owner, 'orders', order),
      ...erpRowsJson(db, owner, 'items', items, 'true', '')
    ]);
    return orderId;
  }

  const fields = ['customer_id','ordered_on','status','channel','address','note','discount',
    'shipping_fee','paid_amount','payment_method'];
  const token = crypto.randomUUID();
  const guard = 'EXISTS (SELECT 1 FROM erp_orders WHERE owner_id=? AND id=? AND write_token=?)';
  const guardArgs = [owner, orderId, token];
  const headerUpdate = db.prepare('UPDATE erp_orders SET ' + fields.map(field => field + '=?').join(',') +
    ',revision=revision+1,write_token=? WHERE owner_id=? AND id=? AND revision=?')
    .bind(...fields.map(field => order[field]), token, owner, orderId, saveRevision);

  const itemFields = ['position','name','sku','quantity','unit_price','note'];
  const upsert = ' ON CONFLICT(owner_id,id) DO UPDATE SET ' +
    itemFields.map(field => field + '=excluded.' + field).join(',') +
    ' WHERE erp_order_items.order_id=excluded.order_id';
  const remove = db.prepare('DELETE FROM erp_order_items WHERE owner_id=? AND order_id=? AND ' +
    'id NOT IN (SELECT value FROM json_each(?)) AND ' + guard)
    .bind(owner, orderId, JSON.stringify([...seen]), ...guardArgs);
  const [result] = await db.batch([
    headerUpdate,
    ...erpRowsJson(db, owner, 'items', items, guard, upsert, guardArgs),
    remove
  ]);
  if (!result.meta.changes) throw new ErpInputError('다른 화면에서 주문이 수정되었습니다. 새로고침 후 다시 시도하세요.', 409);
  return orderId;
}

function erpBackupRows(kind, input) {
  if (!Array.isArray(input)) throw new ErpInputError('백업에 필요한 ERP 기록 목록이 없습니다.');
  const seen = new Set();
  return input.map(raw => {
    erpObject(raw);
    const key = erpId(raw.id, '기록 ID');
    if (seen.has(key)) throw new ErpInputError('백업에 중복된 ERP 기록 ID가 있습니다.');
    seen.add(key);
    if (kind === 'orders') {
      return {
        ...erpOrder(raw, key),
        order_no: erpText(raw.order_no, '주문 번호', 64, true),
        revision: erpInteger(raw.revision, '주문 변경 번호', 1, Number.MAX_SAFE_INTEGER - 1),
        created_at: erpTimestamp(raw.created_at)
      };
    }
    if (kind === 'items') {
      return erpItem(raw, key, erpId(raw.order_id, '주문'), erpInteger(raw.position, '상품 순서', 0, 99));
    }
    return erpRelated(kind, raw, key);
  });
}

export function erpRestoreStatements(db, owner, backup) {
  const rows = Object.fromEntries(Object.keys(erpTables).map(kind => [kind, erpBackupRows(kind, backup[kind])]));
  const orderIds = new Set(rows.orders.map(order => order.id));
  const itemOrders = new Map(rows.items.map(item => [item.id, item.order_id]));
  const itemsByOrder = new Map();
  for (const item of rows.items) {
    if (!orderIds.has(item.order_id)) throw new ErpInputError('백업의 상품이 연결된 주문을 찾을 수 없습니다.');
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push(item);
  }
  for (const order of rows.orders) {
    const items = itemsByOrder.get(order.id);
    if (!items?.length || items.length > 100) throw new ErpInputError('백업의 주문 상품 목록을 확인하세요.');
    erpOrderTotals(order, items);
  }
  for (const shipment of rows.shipments) {
    if (!itemOrders.has(shipment.order_item_id)) throw new ErpInputError('백업의 출고 기록이 연결된 상품을 찾을 수 없습니다.');
  }
  for (const record of [...rows.feedback, ...rows.services]) {
    if (!orderIds.has(record.order_id)) throw new ErpInputError('백업의 만족도 또는 A/S가 연결된 주문을 찾을 수 없습니다.');
    if (record.order_item_id && itemOrders.get(record.order_item_id) !== record.order_id) {
      throw new ErpInputError('백업의 A/S가 연결된 주문 상품을 찾을 수 없습니다.');
    }
  }

  const token = crypto.randomUUID();
  const restoreOrders = rows.orders.map(order => ({...order, write_token: token}));
  const guards = [owner, token];
  const parentOrder = "EXISTS (SELECT 1 FROM erp_orders WHERE owner_id=? AND write_token=? AND id=json_extract(value,'$.order_id'))";
  const shipmentOrder = "EXISTS (SELECT 1 FROM erp_order_items AS item JOIN erp_orders AS ord " +
    "ON ord.owner_id=item.owner_id AND ord.id=item.order_id WHERE item.owner_id=? AND ord.write_token=? " +
    "AND item.id=json_extract(value,'$.order_item_id'))";
  return [
    ...erpRowsJson(db, owner, 'orders', restoreOrders,
      'true', ' ON CONFLICT(owner_id,id) DO NOTHING', [], ['write_token']),
    ...erpRowsJson(db, owner, 'items', rows.items, parentOrder, '', guards),
    ...erpRowsJson(db, owner, 'shipments', rows.shipments, shipmentOrder, '', guards),
    ...erpRowsJson(db, owner, 'feedback', rows.feedback, parentOrder, '', guards),
    ...erpRowsJson(db, owner, 'services', rows.services, parentOrder, '', guards)
  ];
}

export async function erpApi(request, db, owner, path, body) {
  if (request.method === 'GET' && path === '/api/erp') return erpJson(await readErp(db, owner));
  if (request.method !== 'POST' || !path.startsWith('/api/erp/')) return null;

  const kind = path.slice('/api/erp/'.length);
  if (!['orders','shipments','feedback','services','remove'].includes(kind)) return null;
  try {
    erpObject(body);
    if (kind === 'orders') return erpJson({id: await erpSaveOrder(db, owner, body)});
    if (kind === 'remove') {
      if (!['shipments','feedback','services'].includes(body.kind)) {
        throw new ErpInputError('삭제할 기록 종류를 확인하세요.');
      }
      await db.prepare('DELETE FROM ' + erpTables[body.kind].table + ' WHERE owner_id=? AND id=?')
        .bind(owner, erpId(body.id, '삭제할 기록')).run();
      return erpJson({ok: true});
    }

    const editing = erpId(body.id, '기록', true);
    const record = erpRelated(kind, body, editing ?? crypto.randomUUID());
    const statement = editing ? erpUpdate(db, owner, kind, record) : erpInsert(db, owner, kind, record);
    const result = await statement.run();
    if (editing && !result.meta.changes) throw new ErpInputError('수정할 기록을 찾을 수 없습니다.', 404);
    return erpJson({id: record.id});
  } catch (error) {
    const response = erpErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
