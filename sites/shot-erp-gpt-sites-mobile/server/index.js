// ../orders/worker/erp.mjs
var erpTables = {
  orders: {
    table: "erp_orders",
    fields: [
      "id",
      "order_no",
      "customer_id",
      "ordered_on",
      "status",
      "channel",
      "address",
      "note",
      "discount",
      "shipping_fee",
      "paid_amount",
      "payment_method",
      "revision",
      "created_at"
    ],
    order: "ordered_on DESC, created_at DESC, id"
  },
  items: {
    table: "erp_order_items",
    fields: ["id", "order_id", "position", "name", "sku", "quantity", "unit_price", "note"],
    order: "order_id, position, id"
  },
  shipments: {
    table: "erp_shipments",
    fields: ["id", "order_item_id", "extract_id", "quantity", "shipped_on", "note"],
    order: "shipped_on DESC, id"
  },
  feedback: {
    table: "erp_feedback",
    fields: ["id", "order_id", "score", "recorded_on", "note"],
    order: "recorded_on DESC, id"
  },
  services: {
    table: "erp_services",
    fields: ["id", "order_id", "order_item_id", "status", "opened_on", "subject", "note"],
    order: "opened_on DESC, id"
  }
};
var erpOrderStatuses = ["\uC811\uC218", "\uCC98\uB9AC \uC911", "\uC644\uB8CC", "\uCDE8\uC18C"];
var erpServiceStatuses = ["\uC811\uC218", "\uC9C4\uD589 \uC911", "\uC644\uB8CC", "\uCDE8\uC18C"];
var ErpInputError = class extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
function erpJson(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}
function erpErrorResponse(error) {
  if (error instanceof ErpInputError) return erpJson({ error: error.message }, error.status);
  const message = String(error?.message ?? error);
  if (message.includes("ERP_SHIPMENT_LIMIT")) {
    return erpJson({ error: "\uCD1D \uCD9C\uACE0 \uC218\uB7C9\uC740 \uC8FC\uBB38 \uC0C1\uD488\uC758 \uC218\uB7C9\uC744 \uB118\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 409);
  }
  if (message.includes("ERP_ORDER_QUANTITY_LIMIT")) {
    return erpJson({ error: "\uC8FC\uBB38 \uC218\uB7C9\uC740 \uC774\uBBF8 \uCD9C\uACE0\uD55C \uC218\uB7C9 \uC774\uC0C1\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4." }, 409);
  }
  if (message.includes("ERP_ITEM_HAS_HISTORY")) {
    return erpJson({ error: "\uCD9C\uACE0 \uB610\uB294 A/S \uC774\uB825\uC774 \uC5F0\uACB0\uB41C \uC0C1\uD488\uC740 \uC8FC\uBB38\uC5D0\uC11C \uC81C\uAC70\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 409);
  }
  if (message.includes("ERP_ITEM_PRODUCT_LOCKED")) {
    return erpJson({ error: "\uCD9C\uACE0\uB41C \uC0C1\uD488\uC758 \uC774\uB984\uACFC \uC0C1\uD488 \uCF54\uB4DC\uB294 \uBCC0\uACBD\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 409);
  }
  if (message.includes("ERP_ORDER_CUSTOMER_LOCKED")) {
    return erpJson({ error: "\uCD9C\uACE0, \uB9CC\uC871\uB3C4 \uB610\uB294 A/S \uC774\uB825\uC774 \uC788\uB294 \uC8FC\uBB38\uC758 \uACE0\uAC1D\uC740 \uBCC0\uACBD\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 409);
  }
  if (/foreign key/i.test(message)) {
    return erpJson({ error: "\uCC38\uC870\uD55C \uACE0\uAC1D, \uCD94\uCD9C \uAE30\uB85D \uB610\uB294 \uC8FC\uBB38 \uC0C1\uD488\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 409);
  }
  return null;
}
function erpObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ErpInputError("\uAE30\uB85D \uD615\uC2DD\uC744 \uD655\uC778\uD558\uC138\uC694.");
  }
  return value;
}
function erpId(value, label, optional = false) {
  if (optional && (value === void 0 || value === null || value === "")) return null;
  if (typeof value !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) {
    throw new ErpInputError(label + " \uD56D\uBAA9\uC744 \uD655\uC778\uD558\uC138\uC694.");
  }
  return value;
}
function erpText(value, label, max, required = false) {
  if (!required && value == null) return "";
  if (typeof value !== "string" || value.length > max || required && !value.trim()) {
    throw new ErpInputError(label + " \uD56D\uBAA9\uC744 \uD655\uC778\uD558\uC138\uC694.");
  }
  return value.trim();
}
function erpInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ErpInputError(label + " \uD56D\uBAA9\uC758 \uBC94\uC704\uB97C \uD655\uC778\uD558\uC138\uC694.");
  }
  return value;
}
function erpMoney(value, label) {
  return erpInteger(value ?? 0, label, 0, 1e12);
}
function erpQuantity(value, label) {
  return erpInteger(value, label, 1, 1e6);
}
function erpDay(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new ErpInputError(label + " \uD56D\uBAA9\uC744 \uD655\uC778\uD558\uC138\uC694.");
  }
  return value;
}
function erpStatus(value, options, label) {
  if (!options.includes(value)) throw new ErpInputError(label + " \uD56D\uBAA9\uC744 \uD655\uC778\uD558\uC138\uC694.");
  return value;
}
function erpTimestamp(value) {
  if (typeof value !== "string" || value.length > 30 || !Number.isFinite(Date.parse(value))) {
    throw new ErpInputError("\uB4F1\uB85D \uC2DC\uAC01 \uD56D\uBAA9\uC744 \uD655\uC778\uD558\uC138\uC694.");
  }
  return value;
}
function erpOrder(input, orderId) {
  return {
    id: orderId,
    customer_id: erpId(input.customer_id, "\uACE0\uAC1D"),
    ordered_on: erpDay(input.ordered_on, "\uC8FC\uBB38\uC77C"),
    status: erpStatus(input.status, erpOrderStatuses, "\uC8FC\uBB38 \uC0C1\uD0DC"),
    channel: erpText(input.channel, "\uC8FC\uBB38 \uCC44\uB110", 100),
    address: erpText(input.address, "\uBC30\uC1A1 \uC8FC\uC18C", 500),
    note: erpText(input.note, "\uC8FC\uBB38 \uBA54\uBAA8", 1e3),
    discount: erpMoney(input.discount, "\uD560\uC778 \uAE08\uC561"),
    shipping_fee: erpMoney(input.shipping_fee, "\uBC30\uC1A1\uBE44"),
    paid_amount: erpMoney(input.paid_amount, "\uACB0\uC81C \uAE08\uC561"),
    payment_method: erpText(input.payment_method, "\uACB0\uC81C \uC218\uB2E8", 80)
  };
}
function erpItem(input, id2, orderId, position) {
  erpObject(input);
  return {
    id: id2,
    order_id: orderId,
    position,
    name: erpText(input.name, "\uC0C1\uD488 \uC774\uB984", 200, true),
    sku: erpText(input.sku, "\uC0C1\uD488 \uCF54\uB4DC", 100),
    quantity: erpQuantity(input.quantity, "\uC8FC\uBB38 \uC218\uB7C9"),
    unit_price: erpMoney(input.unit_price, "\uC0C1\uD488 \uB2E8\uAC00"),
    note: erpText(input.note, "\uC0C1\uD488 \uBA54\uBAA8", 1e3)
  };
}
function erpRelated(kind, input, id2) {
  if (kind === "shipments") {
    return {
      id: id2,
      order_item_id: erpId(input.order_item_id, "\uC8FC\uBB38 \uC0C1\uD488"),
      extract_id: erpId(input.extract_id, "\uCD94\uCD9C \uAE30\uB85D", true),
      quantity: erpQuantity(input.quantity, "\uCD9C\uACE0 \uC218\uB7C9"),
      shipped_on: erpDay(input.shipped_on, "\uCD9C\uACE0\uC77C"),
      note: erpText(input.note, "\uCD9C\uACE0 \uBA54\uBAA8", 1e3)
    };
  }
  if (kind === "feedback") {
    return {
      id: id2,
      order_id: erpId(input.order_id, "\uC8FC\uBB38"),
      score: erpInteger(input.score, "\uB9CC\uC871\uB3C4", 1, 5),
      recorded_on: erpDay(input.recorded_on, "\uD3C9\uAC00\uC77C"),
      note: erpText(input.note, "\uB9CC\uC871\uB3C4 \uBA54\uBAA8", 1e3)
    };
  }
  return {
    id: id2,
    order_id: erpId(input.order_id, "\uC8FC\uBB38"),
    order_item_id: erpId(input.order_item_id, "\uC8FC\uBB38 \uC0C1\uD488", true),
    status: erpStatus(input.status, erpServiceStatuses, "A/S \uC0C1\uD0DC"),
    opened_on: erpDay(input.opened_on, "A/S \uC811\uC218\uC77C"),
    subject: erpText(input.subject, "A/S \uC81C\uBAA9", 160, true),
    note: erpText(input.note, "A/S \uBA54\uBAA8", 1e3)
  };
}
function erpReadStatements(db, owner) {
  return Object.values(erpTables).map(({ table, fields, order }) => db.prepare(
    "SELECT " + fields.join(",") + " FROM " + table + " WHERE owner_id=? ORDER BY " + order
  ).bind(owner));
}
function erpReadResult(results) {
  return Object.fromEntries(Object.keys(erpTables).map((kind, index) => [kind, results[index].results]));
}
async function readErp(db, owner) {
  return erpReadResult(await db.batch(erpReadStatements(db, owner)));
}
function erpInsert(db, owner, kind, record) {
  const { table, fields } = erpTables[kind];
  const args = fields.map(() => "?").join(",");
  return db.prepare("INSERT INTO " + table + "(owner_id," + fields.join(",") + ") VALUES (?," + args + ")").bind(owner, ...fields.map((field) => record[field]));
}
function erpUpdate(db, owner, kind, record) {
  const { table, fields } = erpTables[kind];
  const mutable = fields.filter((field) => field !== "id");
  return db.prepare("UPDATE " + table + " SET " + mutable.map((field) => field + "=?").join(",") + " WHERE owner_id=? AND id=?").bind(...mutable.map((field) => record[field]), owner, record.id);
}
function erpRowsJson(db, owner, kind, rows2, where, tail, args = [], extraFields = []) {
  const { table, fields: standardFields } = erpTables[kind];
  const fields = [...standardFields, ...extraFields];
  const values = fields.map((field) => "json_extract(value,'$." + field + "')").join(",");
  const sql = "INSERT INTO " + table + "(owner_id," + fields.join(",") + ") SELECT ?," + values + " FROM json_each(?) WHERE " + where + tail;
  const encoder = new TextEncoder();
  const statements = [];
  let chunk = [];
  let bytes = 0;
  function flush() {
    if (chunk.length) statements.push(db.prepare(sql).bind(owner, "[" + chunk.join(",") + "]", ...args));
    chunk = [];
    bytes = 0;
  }
  for (const row2 of rows2) {
    const encoded = JSON.stringify(row2);
    const size = encoder.encode(encoded).length + 1;
    if (bytes + size > 12e4) flush();
    chunk.push(encoded);
    bytes += size;
  }
  flush();
  return statements;
}
function erpOrderTotals(order, items) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const totalBeforeDiscount = subtotal + order.shipping_fee;
  if (!Number.isSafeInteger(totalBeforeDiscount)) throw new ErpInputError("\uC8FC\uBB38 \uAE08\uC561\uC774 \uC800\uC7A5 \uAC00\uB2A5\uD55C \uBC94\uC704\uB97C \uCD08\uACFC\uD569\uB2C8\uB2E4.");
  if (order.discount > totalBeforeDiscount) throw new ErpInputError("\uD560\uC778 \uAE08\uC561\uC740 \uC0C1\uD488 \uD569\uACC4\uC640 \uBC30\uC1A1\uBE44\uC758 \uD569\uC744 \uB118\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
}
async function erpSaveOrder(db, owner, input) {
  const existingId = erpId(input.id, "\uC8FC\uBB38", true);
  const orderId = existingId ?? crypto.randomUUID();
  const order = erpOrder(input, orderId);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
    throw new ErpInputError("\uC8FC\uBB38 \uC0C1\uD488\uC744 1\uAC1C \uC774\uC0C1 100\uAC1C \uC774\uD558\uB85C \uC785\uB825\uD558\uC138\uC694.");
  }
  let knownItems = /* @__PURE__ */ new Set();
  const saveRevision = existingId ? erpInteger(input.revision, "\uC8FC\uBB38 \uBCC0\uACBD \uBC88\uD638", 1, Number.MAX_SAFE_INTEGER - 1) : null;
  if (existingId) {
    const [header, lines] = await db.batch([
      db.prepare("SELECT revision FROM erp_orders WHERE owner_id=? AND id=?").bind(owner, existingId),
      db.prepare("SELECT id FROM erp_order_items WHERE owner_id=? AND order_id=?").bind(owner, existingId)
    ]);
    if (!header.results.length) throw new ErpInputError("\uC218\uC815\uD560 \uC8FC\uBB38\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.", 404);
    if (header.results[0].revision !== saveRevision) throw new ErpInputError("\uB2E4\uB978 \uD654\uBA74\uC5D0\uC11C \uC8FC\uBB38\uC774 \uC218\uC815\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68 \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694.", 409);
    knownItems = new Set(lines.results.map((item) => item.id));
  }
  const seen = /* @__PURE__ */ new Set();
  const items = input.items.map((raw, position) => {
    erpObject(raw);
    const existingItemId = erpId(raw.id, "\uC8FC\uBB38 \uC0C1\uD488", true);
    if (existingItemId && !knownItems.has(existingItemId)) {
      throw new ErpInputError("\uD604\uC7AC \uC8FC\uBB38\uC5D0 \uC5C6\uB294 \uC0C1\uD488 \uAE30\uB85D\uC774 \uD3EC\uD568\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    }
    const itemId = existingItemId ?? crypto.randomUUID();
    if (seen.has(itemId)) throw new ErpInputError("\uAC19\uC740 \uC8FC\uBB38 \uC0C1\uD488\uC774 \uB450 \uBC88 \uD3EC\uD568\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    seen.add(itemId);
    return erpItem(raw, itemId, orderId, position);
  });
  erpOrderTotals(order, items);
  if (!existingId) {
    const orderTail = orderId.replace(/-/g, "").slice(0, 12).toUpperCase();
    order.order_no = "OR-" + order.ordered_on.replace(/-/g, "") + "-" + orderTail;
    order.revision = 1;
    order.created_at = (/* @__PURE__ */ new Date()).toISOString();
    await db.batch([
      erpInsert(db, owner, "orders", order),
      ...erpRowsJson(db, owner, "items", items, "true", "")
    ]);
    return orderId;
  }
  const fields = [
    "customer_id",
    "ordered_on",
    "status",
    "channel",
    "address",
    "note",
    "discount",
    "shipping_fee",
    "paid_amount",
    "payment_method"
  ];
  const token = crypto.randomUUID();
  const guard = "EXISTS (SELECT 1 FROM erp_orders WHERE owner_id=? AND id=? AND write_token=?)";
  const guardArgs = [owner, orderId, token];
  const headerUpdate = db.prepare("UPDATE erp_orders SET " + fields.map((field) => field + "=?").join(",") + ",revision=revision+1,write_token=? WHERE owner_id=? AND id=? AND revision=?").bind(...fields.map((field) => order[field]), token, owner, orderId, saveRevision);
  const itemFields = ["position", "name", "sku", "quantity", "unit_price", "note"];
  const upsert = " ON CONFLICT(owner_id,id) DO UPDATE SET " + itemFields.map((field) => field + "=excluded." + field).join(",") + " WHERE erp_order_items.order_id=excluded.order_id";
  const remove = db.prepare("DELETE FROM erp_order_items WHERE owner_id=? AND order_id=? AND id NOT IN (SELECT value FROM json_each(?)) AND " + guard).bind(owner, orderId, JSON.stringify([...seen]), ...guardArgs);
  const [result] = await db.batch([
    headerUpdate,
    ...erpRowsJson(db, owner, "items", items, guard, upsert, guardArgs),
    remove
  ]);
  if (!result.meta.changes) throw new ErpInputError("\uB2E4\uB978 \uD654\uBA74\uC5D0\uC11C \uC8FC\uBB38\uC774 \uC218\uC815\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68 \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694.", 409);
  return orderId;
}
function erpBackupRows(kind, input) {
  if (!Array.isArray(input)) throw new ErpInputError("\uBC31\uC5C5\uC5D0 \uD544\uC694\uD55C ERP \uAE30\uB85D \uBAA9\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
  const seen = /* @__PURE__ */ new Set();
  return input.map((raw) => {
    erpObject(raw);
    const key = erpId(raw.id, "\uAE30\uB85D ID");
    if (seen.has(key)) throw new ErpInputError("\uBC31\uC5C5\uC5D0 \uC911\uBCF5\uB41C ERP \uAE30\uB85D ID\uAC00 \uC788\uC2B5\uB2C8\uB2E4.");
    seen.add(key);
    if (kind === "orders") {
      return {
        ...erpOrder(raw, key),
        order_no: erpText(raw.order_no, "\uC8FC\uBB38 \uBC88\uD638", 64, true),
        revision: erpInteger(raw.revision, "\uC8FC\uBB38 \uBCC0\uACBD \uBC88\uD638", 1, Number.MAX_SAFE_INTEGER - 1),
        created_at: erpTimestamp(raw.created_at)
      };
    }
    if (kind === "items") {
      return erpItem(raw, key, erpId(raw.order_id, "\uC8FC\uBB38"), erpInteger(raw.position, "\uC0C1\uD488 \uC21C\uC11C", 0, 99));
    }
    return erpRelated(kind, raw, key);
  });
}
function erpRestoreStatements(db, owner, backup) {
  const rows2 = Object.fromEntries(Object.keys(erpTables).map((kind) => [kind, erpBackupRows(kind, backup[kind])]));
  const orderIds = new Set(rows2.orders.map((order) => order.id));
  const itemOrders = new Map(rows2.items.map((item) => [item.id, item.order_id]));
  const itemsByOrder = /* @__PURE__ */ new Map();
  for (const item of rows2.items) {
    if (!orderIds.has(item.order_id)) throw new ErpInputError("\uBC31\uC5C5\uC758 \uC0C1\uD488\uC774 \uC5F0\uACB0\uB41C \uC8FC\uBB38\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push(item);
  }
  for (const order of rows2.orders) {
    const items = itemsByOrder.get(order.id);
    if (!items?.length || items.length > 100) throw new ErpInputError("\uBC31\uC5C5\uC758 \uC8FC\uBB38 \uC0C1\uD488 \uBAA9\uB85D\uC744 \uD655\uC778\uD558\uC138\uC694.");
    erpOrderTotals(order, items);
  }
  for (const shipment of rows2.shipments) {
    if (!itemOrders.has(shipment.order_item_id)) throw new ErpInputError("\uBC31\uC5C5\uC758 \uCD9C\uACE0 \uAE30\uB85D\uC774 \uC5F0\uACB0\uB41C \uC0C1\uD488\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  }
  for (const record of [...rows2.feedback, ...rows2.services]) {
    if (!orderIds.has(record.order_id)) throw new ErpInputError("\uBC31\uC5C5\uC758 \uB9CC\uC871\uB3C4 \uB610\uB294 A/S\uAC00 \uC5F0\uACB0\uB41C \uC8FC\uBB38\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    if (record.order_item_id && itemOrders.get(record.order_item_id) !== record.order_id) {
      throw new ErpInputError("\uBC31\uC5C5\uC758 A/S\uAC00 \uC5F0\uACB0\uB41C \uC8FC\uBB38 \uC0C1\uD488\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    }
  }
  const token = crypto.randomUUID();
  const restoreOrders = rows2.orders.map((order) => ({ ...order, write_token: token }));
  const guards = [owner, token];
  const parentOrder = "EXISTS (SELECT 1 FROM erp_orders WHERE owner_id=? AND write_token=? AND id=json_extract(value,'$.order_id'))";
  const shipmentOrder = "EXISTS (SELECT 1 FROM erp_order_items AS item JOIN erp_orders AS ord ON ord.owner_id=item.owner_id AND ord.id=item.order_id WHERE item.owner_id=? AND ord.write_token=? AND item.id=json_extract(value,'$.order_item_id'))";
  return [
    ...erpRowsJson(
      db,
      owner,
      "orders",
      restoreOrders,
      "true",
      " ON CONFLICT(owner_id,id) DO NOTHING",
      [],
      ["write_token"]
    ),
    ...erpRowsJson(db, owner, "items", rows2.items, parentOrder, "", guards),
    ...erpRowsJson(db, owner, "shipments", rows2.shipments, shipmentOrder, "", guards),
    ...erpRowsJson(db, owner, "feedback", rows2.feedback, parentOrder, "", guards),
    ...erpRowsJson(db, owner, "services", rows2.services, parentOrder, "", guards)
  ];
}
async function erpApi(request, db, owner, path, body) {
  if (request.method === "GET" && path === "/api/erp") return erpJson(await readErp(db, owner));
  if (request.method !== "POST" || !path.startsWith("/api/erp/")) return null;
  const kind = path.slice("/api/erp/".length);
  if (!["orders", "shipments", "feedback", "services", "remove"].includes(kind)) return null;
  try {
    erpObject(body);
    if (kind === "orders") return erpJson({ id: await erpSaveOrder(db, owner, body) });
    if (kind === "remove") {
      if (body.kind === "orders") {
        const orderId = erpId(body.id, "\uC0AD\uC81C\uD560 \uC8FC\uBB38");
        const revision = erpInteger(body.revision, "\uC8FC\uBB38 \uBCC0\uACBD \uBC88\uD638", 1, Number.MAX_SAFE_INTEGER);
        const matchesOrder = "EXISTS (SELECT 1 FROM erp_orders WHERE owner_id=? AND id=? AND revision=?)";
        const order = [owner, orderId, revision];
        const children = ["erp_feedback", "erp_services", "erp_order_items"];
        const results = await db.batch([
          db.prepare("DELETE FROM erp_shipments WHERE owner_id=? AND order_item_id IN (SELECT id FROM erp_order_items WHERE owner_id=? AND order_id=?) AND " + matchesOrder).bind(owner, owner, orderId, ...order),
          ...children.map((table) => db.prepare("DELETE FROM " + table + " WHERE owner_id=? AND order_id=? AND " + matchesOrder).bind(owner, orderId, ...order)),
          db.prepare("DELETE FROM erp_orders WHERE owner_id=? AND id=? AND revision=?").bind(...order)
        ]);
        if (!results.at(-1).meta.changes) {
          throw new ErpInputError("\uC8FC\uBB38\uC774 \uBCC0\uACBD\uB418\uC5C8\uAC70\uB098 \uC774\uBBF8 \uC0AD\uC81C\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uBAA9\uB85D\uC744 \uB2E4\uC2DC \uC5F4\uC5B4 \uD655\uC778\uD574 \uC8FC\uC138\uC694.", 409);
        }
        return erpJson({ ok: true });
      }
      if (!["shipments", "feedback", "services"].includes(body.kind)) {
        throw new ErpInputError("\uC0AD\uC81C\uD560 \uAE30\uB85D \uC885\uB958\uB97C \uD655\uC778\uD558\uC138\uC694.");
      }
      await db.prepare("DELETE FROM " + erpTables[body.kind].table + " WHERE owner_id=? AND id=?").bind(owner, erpId(body.id, "\uC0AD\uC81C\uD560 \uAE30\uB85D")).run();
      return erpJson({ ok: true });
    }
    const editing = erpId(body.id, "\uAE30\uB85D", true);
    const record = erpRelated(kind, body, editing ?? crypto.randomUUID());
    const statement = editing ? erpUpdate(db, owner, kind, record) : erpInsert(db, owner, kind, record);
    const result = await statement.run();
    if (editing && !result.meta.changes) throw new ErpInputError("\uC218\uC815\uD560 \uAE30\uB85D\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.", 404);
    return erpJson({ id: record.id });
  } catch (error) {
    const response = erpErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

// ../orders/worker/index.mjs
var headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
var json = (data, status = 200) => Response.json(data, { status, headers });
var typeFields = {
  customers: ["id", "name", "phone", "address", "created_at"],
  extracts: ["id", "title", "source", "data", "created_at"],
  customer_extracts: ["id", "customer_id", "extract_id", "quantity", "linked_on", "note"]
};
var InputError = class extends Error {
};
function validate(value, condition, message) {
  if (!condition(value)) throw new InputError(message);
  return value;
}
function string(value, max, label, required = false) {
  return validate(value, (text) => typeof text === "string" && text.length <= max && (!required || text.trim().length > 0), label + " \uD56D\uBAA9\uC744 \uD655\uC778\uD558\uC138\uC694.");
}
function id(value) {
  return validate(value, (text) => typeof text === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(text), "\uAE30\uB85D ID\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
}
function isoDate(value) {
  return validate(value, (text) => typeof text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text)) && new Date(text).toISOString().slice(0, 10) === text, "\uC5F0\uACB0 \uB0A0\uC9DC\uB97C \uD655\uC778\uD558\uC138\uC694.");
}
function timestamp(value) {
  return validate(value, (text) => typeof text === "string" && text.length <= 30 && !Number.isNaN(Date.parse(text)), "\uB4F1\uB85D \uB0A0\uC9DC\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
}
function object(value) {
  return validate(value, (item) => item && typeof item === "object" && !Array.isArray(item), "\uB370\uC774\uD130 \uD615\uC2DD\uC744 \uD655\uC778\uD558\uC138\uC694.");
}
function row(table, input, restoring = false) {
  object(input);
  const key = restoring || input.id ? id(input.id) : crypto.randomUUID();
  const created_at = () => restoring ? timestamp(input.created_at) : (/* @__PURE__ */ new Date()).toISOString();
  if (table === "customers") return {
    id: key,
    name: string(input.name, 100, "\uACE0\uAC1D \uC774\uB984", true).trim(),
    phone: string(input.phone ?? "", 80, "\uC5F0\uB77D\uCC98").trim(),
    address: string(input.address ?? "", 500, "\uC8FC\uC18C").trim(),
    created_at: created_at()
  };
  if (table === "extracts") {
    const fields = object(input.data);
    const { __erp_png: png, ...metadata } = fields;
    if (Object.hasOwn(fields, "__erp_png") && (typeof png !== "string" || png.length > 1048576 || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(png) || png.length % 4 !== 0 || atob(png.slice(0, 24)).slice(12, 16) !== "IHDR")) {
      throw new InputError("768KiB \uC774\uD558\uC758 \uC62C\uBC14\uB978 PNG \uD30C\uC77C\uC744 \uC120\uD0DD\uD558\uC138\uC694.");
    }
    const data = JSON.stringify(fields);
    if (!Object.keys(fields).length || new TextEncoder().encode(JSON.stringify(metadata)).length > 4e4) {
      throw new InputError("\uCD94\uCD9C \uAE30\uB85D\uC740 \uBE44\uC5B4 \uC788\uC9C0 \uC54A\uC740 JSON \uAC1D\uCCB4\uC5EC\uC57C \uD558\uBA70 \uD55C \uAC74\uC5D0 40KB\uAE4C\uC9C0 \uC800\uC7A5\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
    }
    return {
      id: key,
      title: string(input.title, 240, "\uCD94\uCD9C \uAE30\uB85D \uC774\uB984", true).trim(),
      source: string(input.source ?? "", 260, "\uCD9C\uCC98").trim(),
      data,
      created_at: created_at()
    };
  }
  const quantity = input.quantity ?? null;
  if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 1e6)) {
    throw new InputError("\uC218\uB7C9\uC740 1\uC5D0\uC11C 1,000,000 \uC0AC\uC774\uC758 \uC815\uC218\uB85C \uC785\uB825\uD558\uC138\uC694.");
  }
  return {
    id: key,
    customer_id: id(input.customer_id),
    extract_id: id(input.extract_id),
    quantity,
    linked_on: isoDate(input.linked_on),
    note: string(input.note ?? "", 1e3, "\uBA54\uBAA8").trim()
  };
}
function rows(table, list, restoring = false) {
  if (!Array.isArray(list)) throw new InputError("\uBAA9\uB85D \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  const seen = /* @__PURE__ */ new Set();
  return list.map((item) => {
    const record = row(table, item, restoring);
    if (seen.has(record.id)) throw new InputError("\uD30C\uC77C\uC5D0 \uC911\uBCF5\uB41C \uAE30\uB85D ID\uAC00 \uC788\uC2B5\uB2C8\uB2E4.");
    seen.add(record.id);
    return record;
  });
}
function inserts(db, owner, table, records, ignore = false) {
  const fields = typeFields[table];
  const values = fields.map((field) => "json_extract(value, '$." + field + "')").join(",");
  const suffix = ignore ? " WHERE true ON CONFLICT(owner_id,id) DO NOTHING" : "";
  const statement = "INSERT INTO " + table + " (owner_id," + fields.join(",") + ") SELECT ?," + values + " FROM json_each(?)" + suffix;
  const encoder = new TextEncoder();
  const chunks = [];
  let current = [], bytes = 0;
  for (const record of records) {
    const value = JSON.stringify(record);
    const size = encoder.encode(value).length + 1;
    if (current.length && bytes + size > 12e4) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(value);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks.map((chunk) => db.prepare(statement).bind(owner, "[" + chunk.join(",") + "]"));
}
async function runBatch(db, statements) {
  if (!statements.length) return [];
  return db.batch(statements);
}
async function read(db, owner, includeOrders = false) {
  const tables = Object.keys(typeFields);
  const ordering = ["created_at DESC, id", "created_at DESC, id", "linked_on DESC, id"];
  const statements = tables.map((table, index) => db.prepare(
    "SELECT " + typeFields[table].join(",") + " FROM " + table + " WHERE owner_id=? ORDER BY " + ordering[index]
  ).bind(owner));
  if (includeOrders) statements.push(...erpReadStatements(db, owner));
  const result = await runBatch(db, statements);
  const records = Object.fromEntries(tables.map((table, index) => [table, result[index].results]));
  records.extracts = records.extracts.map((record) => ({ ...record, data: JSON.parse(record.data) }));
  return includeOrders ? { ...records, ...erpReadResult(result.slice(tables.length)) } : records;
}
async function payload(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new InputError("JSON \uC694\uCCAD\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 8e6) throw new InputError("\uD55C \uBC88\uC5D0 8MB\uAE4C\uC9C0 \uBD88\uB7EC\uC62C \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
  try {
    return object(JSON.parse(text));
  } catch {
    throw new InputError("JSON \uD615\uC2DD\uC744 \uD655\uC778\uD558\uC138\uC694.");
  }
}
async function api(request, db, path, owner) {
  if (request.method === "GET" && path === "/api/records") return json(await read(db, owner));
  if (request.method === "GET" && path === "/api/backup") {
    const records = await read(db, owner, true);
    return json({ format: "customer-extract-links", version: 2, exported_at: (/* @__PURE__ */ new Date()).toISOString(), ...records });
  }
  if (request.method === "GET" && path === "/api/erp") return erpApi(request, db, owner, path);
  if (request.method === "POST") {
    if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "\uC694\uCCAD \uCD9C\uCC98\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 403);
    const body = await payload(request);
    if (path === "/api/rename-extract") {
      const title = string(body.title, 240, "\uCD94\uCD9C \uAE30\uB85D \uC81C\uBAA9", true).trim();
      const result = await db.prepare("UPDATE extracts SET title=? WHERE owner_id=? AND id=?").bind(title, owner, id(body.id)).run();
      if (!result.meta.changes) return json({ error: "\uCD94\uCD9C \uAE30\uB85D\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 404);
      return json({ title });
    }
    if (path === "/api/shot-extract") {
      const record = row("extracts", {
        id: body.id,
        title: body.filename.replace(/\.png$/, ""),
        source: body.filename,
        data: { __shot_filename: body.filename }
      });
      await runBatch(db, inserts(db, owner, "extracts", [record], true));
      return json({ id: record.id });
    }
    if (path.startsWith("/api/erp/")) {
      const result = await erpApi(request, db, owner, path, body);
      if (result) return result;
    }
    if (path === "/api/customers") {
      const customer = row("customers", body);
      if (body.id) {
        const result = await db.prepare("UPDATE customers SET name=?,phone=?,address=? WHERE owner_id=? AND id=?").bind(customer.name, customer.phone, customer.address, owner, customer.id).run();
        if (!result.meta.changes) return json({ error: "\uACE0\uAC1D \uAE30\uB85D\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 404);
      } else {
        await runBatch(db, inserts(db, owner, "customers", [customer]));
      }
      return json({ id: customer.id });
    }
    if (path === "/api/extracts") {
      const records = rows("extracts", body.records);
      if (!records.length) throw new InputError("\uC800\uC7A5\uD560 \uCD94\uCD9C \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
      await runBatch(db, inserts(db, owner, "extracts", records));
      return json({ count: records.length });
    }
    if (path === "/api/links") {
      const record = row("customer_extracts", body);
      await runBatch(db, inserts(db, owner, "customer_extracts", [record]));
      return json({ id: record.id });
    }
    if (path === "/api/unlink") {
      await db.prepare("DELETE FROM customer_extracts WHERE owner_id=? AND id=?").bind(owner, id(body.id)).run();
      return json({ ok: true });
    }
    if (path === "/api/restore") {
      if (body.format !== "customer-extract-links" || ![1, 2].includes(body.version)) {
        throw new InputError("\uBC84\uC804 1 \uB610\uB294 2\uC758 \uACE0\uAC1D\xB7\uCD94\uCD9C \uB370\uC774\uD130 \uBC31\uC5C5 \uD30C\uC77C\uC744 \uC120\uD0DD\uD558\uC138\uC694.");
      }
      const statements = Object.keys(typeFields).flatMap((table) => inserts(db, owner, table, rows(table, body[table], true), true));
      if (body.version === 2) statements.push(...erpRestoreStatements(db, owner, body));
      const result = await runBatch(db, statements);
      return json({ count: result.reduce((count, entry) => count + (entry.meta.changes ?? 0), 0) });
    }
  }
  return json({ error: "\uC694\uCCAD\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 404);
}
var worker_default = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/")) return new Response(null, { status: 404, headers });
    const owner = request.headers.get("oai-authenticated-user-id");
    if (!owner) return json({ error: "\uB85C\uADF8\uC778 \uD6C4 \uC774\uC6A9\uD558\uC138\uC694." }, 401);
    if (!env.DB) return json({ error: "\uB370\uC774\uD130 \uC800\uC7A5\uC18C\uC5D0 \uC5F0\uACB0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 503);
    try {
      return await api(request, env.DB, path, owner);
    } catch (error) {
      if (error instanceof InputError) return json({ error: error.message }, 400);
      const erpError = erpErrorResponse(error);
      if (erpError) return erpError;
      if (/FOREIGN KEY/i.test(error.message)) return json({ error: "\uC5F0\uACB0\uD560 \uACE0\uAC1D \uB610\uB294 \uCD94\uCD9C \uAE30\uB85D\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uBC31\uC5C5\uC758 \uC5F0\uACB0 \uAD00\uACC4\uB3C4 \uD655\uC778\uD558\uC138\uC694." }, 409);
      console.error("Database operation failed", path, error.name);
      return json({ error: "\uC800\uC7A5 \uC791\uC5C5\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694." }, 500);
    }
  }
};

// sites:assets
var assets = { "/": [`<!doctype html>\r
<html lang="ko">\r
<head>\r
  <meta charset="utf-8">\r
  <meta name="viewport" content="width=device-width, initial-scale=1">\r
  <title>\uCD94\uCD9C \uC555\uB825 \uADF8\uB798\uD504</title>\r
  <link rel="stylesheet" href="style.css?v=2026-11-27">\r
</head>\r
<body>\r
  <main>\r
    <header>\r
      <div><p class="eyebrow">SHOT \xB7 PRESSURE MONITOR \xB7 v2026.11.27</p><h1>\uCD94\uCD9C \uADF8\uB798\uD504</h1></div>\r
      <div class="actions program-actions">\r
        <button id="connect">\uC544\uB450\uC774\uB178 \uC5F0\uACB0</button>\r
        <button id="open-orders" type="button" class="secondary">\uACE0\uAC1D \uC8FC\uBB38 \uAD00\uB9AC</button>\r
      </div>\r
    </header>\r
    <p id="connection" role="status">USB\uB85C \uBCF4\uB4DC\uB97C \uC5F0\uACB0\uD55C \uB4A4 \uC544\uB450\uC774\uB178 \uC5F0\uACB0\uC744 \uB204\uB974\uC138\uC694.</p>\r
    <div class="workspace">\r
    <div class="live-panel">\r
    <section class="metrics" aria-label="\uCD94\uCD9C \uC0C1\uD0DC">\r
      <div><span>\uD604\uC7AC \uC555\uB825</span><strong><b id="pressure">\u2014</b> <small>bar</small></strong></div>\r
      <div><span>\uCD94\uCD9C \uC2DC\uAC04</span><strong><b id="elapsed">0.0</b> <small>\uCD08</small></strong></div>\r
      <div><span>\uC0C1\uD0DC</span><strong id="state">\uCD94\uCD9C \uC804</strong></div>\r
    </section>\r
    <section class="chart" id="chart-panel" data-state="waiting">\r
      <canvas id="graph" role="img" aria-label="X\uCD95\uC740 \uCD94\uCD9C \uC2DC\uAC04(\uCD08), Y\uCD95\uC740 \uCD94\uCD9C \uC555\uB825(bar)\uC778 \uC2E4\uC2DC\uAC04 \uADF8\uB798\uD504"></canvas>\r
    </section>\r
    <section class="memo">\r
      <label for="notes">\uCD94\uCD9C \uBA54\uBAA8</label>\r
      <textarea id="notes" rows="5" maxlength="1000" placeholder="\uB3C4\uC9D5\uB7C9: 18g&#10;\uBB3C\uC628\uB3C4: 93\xB0C&#10;\uC18D\uB3C4:&#10;\uC6D0\uB450 / \uBD84\uC1C4\uB3C4 / \uB9DB \uB4F1 \uC790\uC720\uB86D\uAC8C \uAE30\uB85D\uD558\uC138\uC694."></textarea>\r
      <p class="note">\uBA54\uBAA8\uB294 \uADF8\uB798\uD504\uC640 \uD568\uAED8 \uC774\uBBF8\uC9C0\uC5D0 \uC800\uC7A5\uB429\uB2C8\uB2E4. \uBA54\uBAA8 \uC785\uB825 \uC911 \uC2A4\uD398\uC774\uC2A4\uBC14\uB294 \uB744\uC5B4\uC4F0\uAE30\uB85C \uB3D9\uC791\uD569\uB2C8\uB2E4.</p>\r
    </section>\r
    <footer>\r
      <p>\uC555\uB825 <b>1bar \uCD08\uACFC</b> \uB610\uB294 <kbd>Space</kbd>\uB85C \uC2DC\uC791 \xB7 <b>2bar/\uCD08 \uC774\uC0C1 \uD558\uAC15</b> \uB610\uB294 <kbd>Space</kbd>\uB85C \uC644\uB8CC</p>\r
      <div class="actions"><button id="toggle" disabled>\uCD94\uCD9C \uC2DC\uC791 (Space)</button><button id="download" class="secondary" disabled>\uC774\uBBF8\uC9C0 \uC800\uC7A5</button></div>\r
    </footer>\r
    <p id="save-status" role="status" class="note">\uCD94\uCD9C \uC644\uB8CC \uD6C4 \uC800\uC7A5\uD558\uBA74 \uC11C\uBC84\uC5D0 \uB0A0\uC9DC_\uCD94\uCD9C\uBC88\uD638.png\uB85C \uBCF4\uAD00\uB429\uB2C8\uB2E4.</p>\r
    <p class="note">\uC644\uB8CC\uB41C \uADF8\uB798\uD504\uB294 \uB2E4\uC74C \uCD94\uCD9C\uC774 \uC2DC\uC791\uB420 \uB54C \uCD08\uAE30\uD654\uB429\uB2C8\uB2E4. \uC644\uB8CC \uD6C4 30\uCD08 \uB3D9\uC548 \uBC84\uD2BC\xB7\uC2A4\uD398\uC774\uC2A4\uBC14\xB7\uC790\uB3D9 \uC2DC\uC791\uC774 \uC7A0\uAE41\uB2C8\uB2E4. \uC774\uD6C4 \uC555\uB825\uC774 1bar \uC774\uD558\uB85C 1\uCD08\uAC04 \uC720\uC9C0\uB41C \uB4A4 \uB2E4\uC2DC 1bar\uB97C \uCD08\uACFC\uD558\uBA74 \uC790\uB3D9 \uC7AC\uC2DC\uC791\uD569\uB2C8\uB2E4. \uBCF4\uB4DC \uC5F0\uACB0\uC774 \uB04A\uAE30\uBA74 \uAE30\uB85D\uC774 \uC885\uB8CC\uB429\uB2C8\uB2E4.</p>\r
    </div>\r
    <aside class="history" aria-labelledby="history-title">\r
      <div class="history-heading"><h2 id="history-title">\uCD94\uCD9C \uD788\uC2A4\uD1A0\uB9AC</h2><button id="history-refresh" class="secondary">\uC0C8\uB85C\uACE0\uCE68</button></div>\r
      <p id="history-status" class="note" role="status">\uC800\uC7A5\uB41C \uCD94\uCD9C \uAE30\uB85D\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\u2026</p>\r
      <div id="history-list" class="history-list"></div>\r
    </aside>\r
    </div>\r
  </main>\r
  <iframe id="orders-frame" title="\uACE0\uAC1D \uC8FC\uBB38 \uAD00\uB9AC" allow="clipboard-write 'self'" hidden></iframe>\r
  <dialog id="history-preview" aria-labelledby="preview-title">\r
    <div class="preview-heading">\r
      <div class="preview-title-area">\r
        <h2 id="preview-title"><button id="edit-record-title" class="editable-title" type="button" title="\uD074\uB9AD\uD558\uC5EC \uC81C\uBAA9 \uC218\uC815">\uCD94\uCD9C \uAE30\uB85D</button></h2>\r
        <form id="history-title-form" class="record-title-form" hidden>\r
          <input id="history-record-title" type="text" maxlength="120" aria-label="\uAE30\uB85D \uC81C\uBAA9">\r
          <button type="submit">\uC81C\uBAA9 \uC800\uC7A5</button>\r
          <button id="cancel-record-title" type="button" class="secondary">\uCDE8\uC18C</button>\r
        </form>\r
      </div>\r
      <button id="preview-close" class="secondary">\uB2EB\uAE30</button>\r
    </div>\r
    <p id="preview-status" class="note" role="status"></p>\r
    <p id="history-title-status" class="note" role="status"></p>\r
    <section class="memo">\r
      <label for="history-notes">\uCD94\uCD9C \uBA54\uBAA8</label>\r
      <textarea id="history-notes" rows="4" maxlength="1000" disabled></textarea>\r
      <p id="history-notes-status" class="note" role="status"></p>\r
      <button id="history-notes-save" type="button" disabled>\uBA54\uBAA8 \uC800\uC7A5</button>\r
    </section>\r
    <img id="preview-image" alt="\uC800\uC7A5\uB41C \uCD94\uCD9C \uADF8\uB798\uD504\uC640 \uBA54\uBAA8">\r
    <div class="actions program-actions">\r
      <a id="preview-download" class="image-link" download>\uC6D0\uBCF8 \uC774\uBBF8\uC9C0 \uB2E4\uC6B4\uB85C\uB4DC</a>\r
      <button id="preview-order" class="secondary" type="button">\uC8FC\uBB38 \uAD00\uB9AC\uC5D0\uC11C \uBCF4\uAE30</button>\r
    </div>\r
  </dialog>\r
  <script type="module" src="app.mjs?v=2026-11-27"><\/script>\r
</body>\r
</html>\r
`, "text/html"], "/style.css": [':root { color-scheme: dark; font-family: system-ui, sans-serif; color: #e6edf6; background: #10161f; }\r\n* { box-sizing: border-box; }\r\nbody { margin: 0; }\r\nmain { max-width: 1550px; padding: 40px 28px; margin: auto; }\r\n.workspace { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 24px; align-items: start; }\r\n.live-panel { min-width: 0; }\r\n.history { position: sticky; top: 20px; margin-top: 24px; padding: 18px; border: 1px solid #2b394b; border-radius: 12px; background: #192331; }\r\n.history-heading, .preview-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }\r\n.history-heading h2, .preview-heading h2 { font-size: 18px; margin: 0; }\r\n.history-heading button { padding: 8px 10px; font-size: 12px; }\r\n.history-list { display: grid; gap: 12px; max-height: 70vh; overflow-y: auto; }\r\n.history-card { display: grid; gap: 8px; width: 100%; text-align: left; padding: 10px; color: #e6edf6; background: #10161f; border-color: #2b394b; }\r\n.history-card:hover { border-color: #74d6bf; }\r\n.history-card img { width: 100%; height: 125px; object-fit: contain; background: #192331; border-radius: 5px; }\r\n.history-card small { color: #a6b6c9; font-weight: 400; }\r\ndialog { width: min(1100px, 95vw); max-height: 92vh; overflow: auto; padding: 20px; background: #192331; color: #e6edf6; border: 1px solid #42526a; border-radius: 12px; }\r\ndialog::backdrop { background: #080d15cc; }\r\n.preview-heading { position: sticky; top: -20px; padding: 12px 0; background: #192331; }\r\n#preview-image { width: 100%; display: block; margin: 16px 0; }\r\n.image-link { color: #74d6bf; }\r\n@media (max-width: 1000px) { .workspace { grid-template-columns: minmax(0, 1fr); } .history { position: static; margin-top: 0; } .history-list { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); max-height: 500px; } }\r\nheader, footer, .actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; }\r\nh1 { font-size: 32px; margin: 4px 0 12px; }\r\n.eyebrow { color: #7dd3c4; font-size: 12px; letter-spacing: 2px; }\r\nbutton { background: #74d6bf; color: #10161f; border: 1px solid transparent; border-radius: 9px; padding: 12px 18px; font-size: 14px; font-weight: 700; cursor: pointer; white-space: nowrap; }\r\nbutton:disabled { opacity: .4; cursor: default; }\r\nbutton:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }\r\n.secondary { color: #d4dde9; border-color: #39485d; background: transparent; }\r\n#connection, .note, footer p { font-size: 14px; color: #a6b6c9; line-height: 1.8; }\r\n.metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 24px 0; }\r\n.metrics > div { background: #192331; padding: 22px; border-radius: 12px; }\r\n.metrics span { display: block; color: #a6b6c9; font-size: 14px; margin-bottom: 10px; }\r\n.metrics strong { font-size: 32px; font-variant-numeric: tabular-nums; }\r\n.metrics b { font-weight: 650; }\r\n.metrics small { font-size: 16px; font-weight: 400; color: #a6b6c9; }\r\n#state { font-size: 25px; }\r\n.chart { background: #192331; padding: 16px; border-radius: 12px; }\r\n.chart[data-state="waiting"] { box-shadow: 0 0 0 2px #94a3b8; }\r\n.chart[data-state="recording"] { box-shadow: 0 0 0 3px #fbbf24; }\r\n.chart[data-state="completed"] { box-shadow: 0 0 0 2px #74d6bf; }\r\n.memo { margin-top: 20px; }\r\n.memo label { display: block; margin-bottom: 10px; font-weight: 600; }\r\ntextarea { width: 100%; resize: vertical; padding: 14px; border: 1px solid #42526a; border-radius: 9px; background: #192331; color: #e6edf6; font: 16px/1.6 system-ui, sans-serif; }\r\ntextarea:focus { outline: 2px solid #74d6bf; outline-offset: 2px; }\r\ncanvas { width: 100%; height: 420px; display: block; }\r\nfooter { margin-top: 20px; flex-wrap: wrap; }\r\nkbd { background: #29384c; border: 1px solid #42526a; padding: 2px 6px; border-radius: 4px; }\r\n@media (max-width: 650px) { main { padding: 20px 12px; } .metrics { gap: 8px; } .metrics > div { padding: 14px 10px; } .metrics strong { font-size: 24px; } #state { font-size: 18px; } canvas { height: 320px; } }\r\n.program-actions { flex-wrap: wrap; justify-content: flex-end; }\r\n#history-preview .program-actions { justify-content: flex-start; }\r\n.preview-title-area { min-width: 0; }\r\n.editable-title { border: 0; background: transparent; color: inherit; font: inherit; padding: 0; text-align: left; white-space: normal; overflow-wrap: anywhere; }\r\n.editable-title:hover { text-decoration: underline; }\r\n.record-title-form:not([hidden]) { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }\r\n.record-title-form input { max-width: 100%; min-width: 0; width: 32ch; padding: 10px; border: 1px solid #42526a; border-radius: 8px; font: inherit; }\r\n#orders-frame { border: 0; width: 100%; height: 100vh; }\r\n#orders-frame:not([hidden]) { display: block; }\r\n#orders-frame { height: 100dvh; }\r\n.history-card { min-width: 0; white-space: normal; overflow-wrap: anywhere; }\r\n@media (max-width: 650px) {\r\n  header { display: grid; gap: 8px; }\r\n  header .program-actions { justify-content: flex-start; gap: 8px; }\r\n  .program-actions button, .history-heading button, #preview-close { min-height: 44px; }\r\n  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }\r\n  .metrics > div:last-child { grid-column: 1 / -1; }\r\n  .serial-unavailable #connect { display: none; }\r\n  .serial-unavailable .history { grid-row: 1; }\r\n  .history-list { grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr)); }\r\n  dialog { max-height: 92dvh; padding: 14px; }\r\n  .preview-heading { top: -14px; }\r\n  .record-title-form input { font-size: 16px; }\r\n}\r\n', "text/css"], "/orders/": [`<!doctype html>\r
<html lang="ko">\r
<head>\r
<meta charset="utf-8">\r
<meta name="viewport" content="width=device-width,initial-scale=1">\r
<title>\uC8FC\uBB38 \uAD00\uB9AC ERP</title>\r
<link rel="stylesheet" href="/orders/app.css">\r
<link rel="stylesheet" href="/orders/erp.css">\r
<link rel="stylesheet" href="/orders/erp-service.css">\r
<script src="/orders/app.js" defer><\/script>\r
<script src="/orders/erp-service.js" defer><\/script>\r
<script src="/orders/erp.js" defer><\/script>\r
</head>\r
<body>\r
<header><div class="wrap top">\r
  <div><h1>\uC8FC\uBB38 \uAD00\uB9AC ERP</h1><p>\uC8FC\uBB38, \uCD9C\uACE0 \uB85C\uD2B8, \uACE0\uAC1D \uC0AC\uD6C4 \uAD00\uB9AC\uB97C \uD55C\uACF3\uC5D0\uC11C \uD655\uC778\uD558\uC138\uC694.</p></div>\r
  <div class="actions">\r
    <a id="return-to-graph" class="graph-link" href="/">\r
      <span class="graph-link-icon" aria-hidden="true"></span>\uCD94\uCD9C \uADF8\uB798\uD504\r
    </a>\r
    <button id="import-extract" class="primary" type="button">\uCD94\uCD9C \uB370\uC774\uD130 \uCD94\uAC00</button>\r
    <details id="data-menu"><summary>\uBC31\uC5C5 \uAD00\uB9AC</summary><div class="menu">\r
      <button id="backup" type="button">\uC804\uCCB4 \uB0B4\uBCF4\uB0B4\uAE30</button>\r
      <button id="restore" type="button">\uBC31\uC5C5 \uBD88\uB7EC\uC624\uAE30</button>\r
    </div></details>\r
    <input id="backup-file" type="file" accept=".json,application/json" hidden>\r
  </div>\r
</div></header>\r
<main class="wrap">\r
  <p id="notice" role="status" hidden></p>\r
  <nav class="tabs" aria-label="\uC5C5\uBB34 \uBA54\uB274">\r
    <button id="order-tab" type="button" aria-pressed="true">\uC8FC\uBB38</button>\r
    <button id="customer-tab" type="button" aria-pressed="false">\uACE0\uAC1D <span id="customer-count">0</span></button>\r
    <button id="extract-tab" type="button" aria-pressed="false">\uCD94\uCD9C \uAE30\uB85D <span id="extract-count">0</span></button>\r
  </nav>\r
  <div class="workspace" id="records-view" hidden>\r
    <section class="panel side" aria-labelledby="list-title">\r
      <div class="side-head">\r
        <div class="section-head"><h2 id="list-title">\uACE0\uAC1D \uBAA9\uB85D</h2><button id="add-customer" type="button">\uACE0\uAC1D \uB4F1\uB85D</button></div>\r
        <input id="search" type="search" aria-label="\uACE0\uAC1D \uC774\uB984 \uB610\uB294 \uC5F0\uB77D\uCC98 \uAC80\uC0C9" placeholder="\uC774\uB984 \uB610\uB294 \uC5F0\uB77D\uCC98 \uAC80\uC0C9">\r
      </div>\r
      <div id="list"></div>\r
    </section>\r
    <section class="panel detail" id="detail" aria-label="\uC120\uD0DD\uD55C \uAE30\uB85D \uC0C1\uC138"></section>\r
  </div>\r
  <section id="erp-view" aria-label="\uC8FC\uBB38 \uAD00\uB9AC" hidden>\r
  <dl class="erp-overview" aria-label="\uC804\uCCB4 \uC8FC\uBB38 \uD604\uD669">\r
    <div><dt>\uC804\uCCB4 \uC8FC\uBB38</dt><dd id="erp-total-count">0\uAC74</dd></div>\r
    <div><dt>\uBBF8\uACB0\uC81C \uAE08\uC561</dt><dd id="erp-open-payment">0\uC6D0</dd></div>\r
    <div><dt>\uCD9C\uACE0 \uB300\uAE30</dt><dd id="erp-open-shipping">0\uAC74</dd></div>\r
    <div><dt>\uC8FC\uBB38 \uD569\uACC4</dt><dd id="erp-order-total">0\uC6D0</dd></div>\r
  </dl>\r
  <div class="erp-workspace">\r
    <section class="panel erp-list-panel" aria-labelledby="erp-list-title">\r
      <div class="erp-list-controls">\r
        <div class="section-head"><h2 id="erp-list-title">\uC8FC\uBB38 \uBAA9\uB85D</h2><button id="erp-add-order" class="primary" type="button">\uC8FC\uBB38 \uB4F1\uB85D</button></div>\r
        <input id="erp-search" type="search" aria-label="\uC8FC\uBB38 \uAC80\uC0C9" placeholder="\uC8FC\uBB38\uBC88\uD638, \uACE0\uAC1D, \uC0C1\uD488, \uB85C\uD2B8 \uAC80\uC0C9">\r
        <div class="erp-scope" id="erp-scope" hidden></div>\r
        <details class="erp-filters"><summary>\uC0C1\uC138 \uD544\uD130</summary>\r
          <div class="erp-fields">\r
            <label>\uC2DC\uC791\uC77C<input type="date" id="erp-date-from"></label>\r
            <label>\uC885\uB8CC\uC77C<input type="date" id="erp-date-to"></label>\r
            <label>\uC8FC\uBB38 \uC0C1\uD0DC<select id="erp-status-filter"></select></label>\r
            <label>\uACB0\uC81C \uC0C1\uD0DC<select id="erp-payment-filter"></select></label>\r
            <label>\uCD9C\uACE0 \uC0C1\uD0DC<select id="erp-shipping-filter"></select></label>\r
            <div class="erp-filter-actions"><button id="erp-reset" type="button">\uCD08\uAE30\uD654</button></div>\r
          </div>\r
        </details>\r
        <p id="erp-match-count" class="muted" role="status"></p>\r
      </div>\r
      <div id="erp-list"></div>\r
    </section>\r
    <section class="panel detail erp-detail" id="erp-detail" aria-label="\uC120\uD0DD\uD55C \uC8FC\uBB38 \uC0C1\uC138" tabindex="-1"></section>\r
  </div>\r
</section>\r
<dialog id="erp-order-dialog" class="erp-dialog" aria-labelledby="erp-order-dialog-title">\r
  <form id="erp-order-form">\r
    <h2 id="erp-order-dialog-title">\uC8FC\uBB38 \uB4F1\uB85D</h2>\r
    <div class="erp-fields" id="erp-order-fields"></div>\r
    <section class="erp-form-section" aria-labelledby="erp-order-items-title">\r
      <div class="section-head"><h3 id="erp-order-items-title">\uC8FC\uBB38 \uC0C1\uD488</h3><button type="button" id="erp-add-line">\uC0C1\uD488 \uCD94\uAC00</button></div>\r
      <div id="erp-lines"></div>\r
    </section>\r
    <div class="erp-form-totals" id="erp-form-totals" aria-live="polite"></div>\r
    <p class="form-error" role="alert" hidden></p>\r
    <div class="actions"><button id="erp-close-order" type="button">\uB2EB\uAE30</button><button id="erp-save-order" class="primary" type="submit">\uC8FC\uBB38 \uC800\uC7A5</button></div>\r
  </form>\r
</dialog>\r
\r
</main>\r
<dialog id="customer-dialog" aria-labelledby="customer-title">\r
  <form id="customer-form">\r
    <h2 id="customer-title">\uACE0\uAC1D \uB4F1\uB85D</h2>\r
    <label>\uACE0\uAC1D \uC774\uB984<input name="name" required maxlength="100" autofocus></label>\r
    <label>\uC5F0\uB77D\uCC98<input name="phone" type="tel" maxlength="80"></label>\r
    <label>\uC8FC\uC18C<textarea name="address" rows="2" maxlength="500"></textarea></label>\r
    <p class="form-error" role="alert" hidden></p>\r
    <div class="actions"><button data-close type="button">\uB2EB\uAE30</button><button class="primary" type="submit">\uACE0\uAC1D \uC800\uC7A5</button></div>\r
  </form>\r
</dialog>\r
<dialog id="extract-dialog" aria-labelledby="extract-title">\r
  <form id="extract-form">\r
    <h2 id="extract-title">\uCD94\uCD9C \uB370\uC774\uD130 \uCD94\uAC00</h2>\r
    <p class="muted">PNG(\uCD5C\uB300 768KiB), CSV, JSON \uD30C\uC77C\uC744 \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. CSV\uB294 \uCCAB \uD589\uC744 \uD56D\uBAA9 \uC774\uB984\uC73C\uB85C \uC0AC\uC6A9\uD569\uB2C8\uB2E4.</p>\r
    <label>\uD30C\uC77C \uC120\uD0DD<input id="extract-file" type="file" accept=".png,.csv,.json,image/png,text/csv,application/json"></label>\r
    <label>\uAE30\uB85D \uC774\uB984 \uB610\uB294 \uC774\uB984 \uC811\uB450\uC0AC<input name="title" maxlength="200" placeholder="\uC608: 11\uC6D4 \uC0DD\uC0B0 \uAE30\uB85D"></label>\r
    <label>CSV \uB610\uB294 JSON \uB0B4\uC6A9<textarea id="extract-text" name="text" rows="6" placeholder='{"\uC0C1\uD488\uBA85":"\uC74C\uB8CC A","\uB85C\uD2B8":"2026-001"}' spellcheck="false"></textarea></label>\r
    <div id="import-preview" hidden><h3 id="preview-title"></h3><img id="preview-image" class="extract-image" alt="\uCD94\uCD9C \uADF8\uB798\uD504 \uBBF8\uB9AC\uBCF4\uAE30" hidden><pre id="preview-data"></pre></div>\r
    <p class="form-error" role="alert" hidden></p>\r
    <div class="actions">\r
      <button data-close type="button">\uB2EB\uAE30</button><button id="preview" type="button">\uBBF8\uB9AC\uBCF4\uAE30</button><button class="primary" id="save-extract" type="submit" disabled>\uCD94\uCD9C \uAE30\uB85D \uC800\uC7A5</button>\r
    </div>\r
  </form>\r
</dialog>\r
<dialog id="link-dialog" aria-labelledby="link-title">\r
  <form id="link-form">\r
    <h2 id="link-title">\uCD94\uCD9C \uAE30\uB85D \uC5F0\uACB0</h2>\r
    <p class="muted" id="link-customer"></p>\r
    <label>\uCD94\uCD9C \uAE30\uB85D<select name="extract_id" required></select></label>\r
    <div class="form-grid">\r
      <label>\uC5F0\uACB0 \uB0A0\uC9DC<input name="linked_on" type="date" required></label>\r
      <label>\uC218\uB7C9<input name="quantity" type="number" min="1" max="1000000" step="1"></label>\r
    </div>\r
    <label>\uC5F0\uACB0 \uBA54\uBAA8<textarea name="note" maxlength="1000" rows="2"></textarea></label>\r
    <p class="form-error" role="alert" hidden></p>\r
    <div class="actions"><button data-close type="button">\uB2EB\uAE30</button><button class="primary" type="submit">\uC5F0\uACB0 \uC800\uC7A5</button></div>\r
  </form>\r
</dialog>\r
<script type="module" src="/window.mjs"><\/script>\r
</body>\r
</html>\r
`, "text/html"], "/app.mjs": ["import { ExtractionSession } from './session.mjs?v=2026-11-18';\r\nimport { receivePressure } from './serial.mjs?v=2026-11-18';\r\nimport { chooseAutomaticPort, portIdentity } from './autoconnect.mjs?v=2026-11-18';\r\nimport './window.mjs?v=2026-11-25-r2';\r\nimport { restoreCompleted, persistCompleted } from './persistence.mjs?v=2026-11-18';\r\n\r\nlet restored;\r\ntry { restored = restoreCompleted(localStorage, performance.now(), Date.now()); } catch { /* \uBE0C\uB77C\uC6B0\uC800 \uC800\uC7A5\uC18C \uC0AC\uC6A9 \uBD88\uAC00 */ }\r\nconst session = restored?.session ?? new ExtractionSession();\r\nconst $ = id => document.getElementById(id);\r\nif (restored?.notes) $('notes').value = restored.notes;\r\nlet persistedState = session.state;\r\nlet persistedEnd = session.endedAt;\r\n\r\nfunction rememberCompleted(force = false) {\r\n  if (!force && persistedState === session.state && persistedEnd === session.endedAt) return;\r\n  persistedState = session.state;\r\n  persistedEnd = session.endedAt;\r\n  try { persistCompleted(localStorage, session, performance.now(), Date.now(), $('notes').value); }\r\n  catch (error) { console.warn('\uC644\uB8CC \uAE30\uB85D \uBCF5\uC6D0\uC6A9 \uC800\uC7A5 \uC2E4\uD328:', error); }\r\n}\r\n\r\n$('notes').addEventListener('input', () => {\r\n  if (session.state === 'completed') rememberCompleted(true);\r\n});\r\nconst canvas = $('graph');\r\nconst ctx = canvas.getContext('2d');\r\nlet port = null;\r\nlet reader = null;\r\nlet connected = false;\r\nlet closing = false;\r\nlet lastDataAt = null;\r\nlet busy = false;\r\nlet saving = false;\r\nlet readWarning = '';\r\nconst stateColors = { waiting: '#94a3b8', recording: '#fbbf24', completed: '#74d6bf' };\r\n\r\nfunction refresh() {\r\n  rememberCompleted();\r\n  const stale = lastDataAt === null || performance.now() - lastDataAt > 2000;\r\n  $('pressure').textContent = !connected || stale || session.pressure === null ? '\u2014' : session.pressure.toFixed(2);\r\n  $('elapsed').textContent = session.elapsed(performance.now()).toFixed(1);\r\n  $('state').textContent = { waiting: '\uCD94\uCD9C \uC804', recording: '\uCD94\uCD9C \uC911', completed: '\uCD94\uCD9C \uC644\uB8CC' }[session.state];\r\n  if (session.completionReason === 'pressure-drop') $('state').textContent += ' (\uC790\uB3D9)';\r\n  $('state').style.color = stateColors[session.state];\r\n  $('chart-panel').dataset.state = session.state;\r\n  const cooldown = session.cooldownRemainingMs(performance.now());\r\n  $('toggle').textContent = cooldown > 0 ? `\uC7AC\uC2DC\uC791 \uB300\uAE30 (${Math.ceil(cooldown / 1000)}\uCD08)`\r\n    : session.state === 'recording' ? '\uCD94\uCD9C \uC644\uB8CC (Space)' : '\uCD94\uCD9C \uC2DC\uC791 (Space)';\r\n  $('toggle').disabled = cooldown > 0 || !connected || (stale && session.state !== 'recording');\r\n  $('download').disabled = saving || session.state !== 'completed' || session.points.length === 0;\r\n  if (connected && !closing) {\r\n    const delay = lastDataAt === null ? '\uC555\uB825 \uB370\uC774\uD130 \uB300\uAE30 \uC911' : `\uC555\uB825 \uC218\uC2E0 \uC911\uB2E8 \xB7 \uB9C8\uC9C0\uB9C9 \uC218\uC2E0 ${Math.floor((performance.now() - lastDataAt) / 1000)}\uCD08 \uC804`;\r\n    $('connection').textContent = readWarning || (stale\r\n      ? `\uC5F0\uACB0\uB428 \xB7 ${delay}. \uACC4\uC18D\uB418\uBA74 \uAE30\uB85D\uC744 \uC800\uC7A5\uD558\uACE0 \uC5F0\uACB0 \uD574\uC81C \uD6C4 \uB2E4\uC2DC \uC5F0\uACB0\uD558\uC138\uC694.`\r\n      : '\uC5F0\uACB0\uB428 \xB7 \uC555\uB825 \uB370\uC774\uD130 \uC218\uC2E0 \uC911 (115200 baud)');\r\n  }\r\n  draw();\r\n}\r\n\r\nfunction draw() {\r\n  const ratio = window.devicePixelRatio || 1;\r\n  const width = canvas.clientWidth;\r\n  const height = canvas.clientHeight;\r\n  if (!width || !height) return;\r\n  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {\r\n    canvas.width = Math.round(width * ratio);\r\n    canvas.height = Math.round(height * ratio);\r\n  }\r\n  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);\r\n  ctx.clearRect(0, 0, width, height);\r\n  ctx.fillStyle = '#192331';\r\n  ctx.fillRect(0, 0, width, height);\r\n  ctx.strokeStyle = stateColors[session.state]; ctx.lineWidth = 2;\r\n  ctx.strokeRect(1, 1, width - 2, height - 2);\r\n  ctx.lineWidth = 1;\r\n  const left = 58, top = 60, right = width - 20, bottom = height - 52;\r\n  const duration = session.elapsed(performance.now());\r\n  ctx.fillStyle = '#e6edf6'; ctx.textAlign = 'left'; ctx.font = 'bold 14px system-ui';\r\n  const peak = session.peakPressure === null ? '\u2014' : session.peakPressure.toFixed(2);\r\n  ctx.fillText(`\uD53C\uD06C \uC555\uB825: ${peak} bar`, left, 22);\r\n  ctx.fillText(`${session.state === 'completed' ? '\uCD5C\uC885 \uC2DC\uAC04' : '\uCD94\uCD9C \uC2DC\uAC04'}: ${duration.toFixed(1)}\uCD08`, left, 44);\r\n  const maxTime = Math.max(60, Math.ceil(duration / 10) * 10);\r\n  const maxPressure = 20;\r\n  const x = t => left + t / maxTime * (right - left);\r\n  const y = p => bottom - p / maxPressure * (bottom - top);\r\n  ctx.font = '12px system-ui';\r\n  for (let i = 0; i <= 6; i++) {\r\n    const t = maxTime * i / 6;\r\n    ctx.strokeStyle = '#2b394b';\r\n    ctx.beginPath(); ctx.moveTo(x(t), top); ctx.lineTo(x(t), bottom); ctx.stroke();\r\n    ctx.fillStyle = '#a6b6c9';\r\n    ctx.textAlign = 'center'; ctx.fillText(t.toFixed(0), x(t), bottom + 22);\r\n  }\r\n  for (let p = 0; p <= maxPressure; p += 5) {\r\n    ctx.strokeStyle = '#2b394b';\r\n    ctx.beginPath(); ctx.moveTo(left, y(p)); ctx.lineTo(right, y(p)); ctx.stroke();\r\n    ctx.fillStyle = '#a6b6c9'; ctx.textAlign = 'right';\r\n    ctx.fillText(p.toFixed(0), left - 10, y(p) + 4);\r\n  }\r\n  ctx.fillStyle = '#a6b6c9'; ctx.textAlign = 'center';\r\n  ctx.fillText('\uCD94\uCD9C \uC2DC\uAC04 (\uCD08)', (left + right) / 2, height - 6);\r\n  ctx.save(); ctx.translate(14, (top + bottom) / 2); ctx.rotate(-Math.PI / 2);\r\n  ctx.fillText('\uCD94\uCD9C \uC555\uB825 (bar)', 0, 0); ctx.restore();\r\n  ctx.save();\r\n  ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();\r\n  if (session.peakPressure !== null && session.peakPressure <= maxPressure) {\r\n    ctx.save();\r\n    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.5; ctx.setLineDash([7, 5]);\r\n    ctx.beginPath(); ctx.moveTo(left, y(session.peakPressure));\r\n    ctx.lineTo(right, y(session.peakPressure)); ctx.stroke();\r\n    ctx.restore();\r\n  }\r\n  ctx.strokeStyle = '#74d6bf'; ctx.lineWidth = 2.5;\r\n  ctx.beginPath();\r\n  session.points.forEach((point, i) => {\r\n    if (i === 0) ctx.moveTo(x(point.time), y(point.pressure));\r\n    else ctx.lineTo(x(point.time), y(point.pressure));\r\n  });\r\n  ctx.stroke();\r\n  if (session.points.length === 1) {\r\n    const p = session.points[0]; ctx.fillStyle = '#74d6bf';\r\n    ctx.beginPath(); ctx.arc(x(p.time), y(p.pressure), 3, 0, Math.PI * 2); ctx.fill();\r\n  }\r\n  ctx.restore();\r\n}\r\n\r\nfunction toggleRecording() {\r\n  if ($('toggle').disabled) return;\r\n  if (session.state === 'recording') session.finish(performance.now());\r\n  else session.start(performance.now());\r\n  refresh();\r\n}\r\n\r\n$('toggle').addEventListener('click', toggleRecording);\r\nwindow.addEventListener('keydown', event => {\r\n  if ($('history-preview').open || event.target.closest('.history')) return;\r\n  if (event.code !== 'Space' || event.target.closest('input, textarea, select, [contenteditable]')) return;\r\n  event.preventDefault();\r\n  if (!event.repeat) toggleRecording();\r\n});\r\n\r\n$('connect').addEventListener('click', async () => {\r\n  if (closing || (busy && !connected)) return;\r\n  if (connected) {\r\n    closing = true;\r\n    $('connect').disabled = true;\r\n    try { await reader?.cancel(); }\r\n    catch { /* \uC77D\uAE30 \uB8E8\uD504\uC758 finally\uC5D0\uC11C \uC5F0\uACB0 \uC815\uB9AC */ }\r\n    return;\r\n  }\r\n  await connectPort();\r\n});\r\n\r\nasync function connectPort(knownPort = null) {\r\n  if (busy || connected || closing) return;\r\n  busy = true;\r\n  $('connect').disabled = true;\r\n  $('connection').textContent = knownPort ? '\uC774\uC804\uC5D0 \uD5C8\uC6A9\uD55C \uC544\uB450\uC774\uB178\uC5D0 \uC790\uB3D9 \uC5F0\uACB0 \uC911\u2026' : '\uC544\uB450\uC774\uB178 \uD3EC\uD2B8\uB97C \uC120\uD0DD\uD574\uC8FC\uC138\uC694.';\r\n  try {\r\n    port = knownPort ?? await navigator.serial.requestPort();\r\n    await port.open({ baudRate: 115200 });\r\n    try { localStorage.setItem('shot-port-identity', portIdentity(port)); } catch { /* \uC800\uC7A5\uC18C \uC0AC\uC6A9 \uBD88\uAC00 */ }\r\n    connected = true;\r\n    closing = false;\r\n    session.pressure = null;\r\n    lastDataAt = null;\r\n    readWarning = '';\r\n    $('connect').textContent = '\uC5F0\uACB0 \uD574\uC81C';\r\n    $('connect').disabled = false;\r\n    await receivePressure(port, {\r\n      onPressure: pressure => {\r\n        session.ingest(pressure, performance.now());\r\n        rememberCompleted();\r\n        lastDataAt = performance.now();\r\n        readWarning = '';\r\n      },\r\n      onReader: value => { reader = value; },\r\n      onReadError: (error, attempt) => {\r\n        readWarning = `\uC2DC\uB9AC\uC5BC \uC218\uC2E0 \uC624\uB958 (${error.name}) \xB7 \uC218\uC2E0 \uBCF5\uAD6C \uC2DC\uB3C4 ${attempt}/3. \uACC4\uC18D\uB418\uBA74 \uAE30\uB85D\uC744 \uC800\uC7A5\uD558\uACE0 \uB2E4\uC2DC \uC5F0\uACB0\uD558\uC138\uC694.`;\r\n      },\r\n      shouldStop: () => closing,\r\n    });\r\n    $('connection').textContent = '\uC5F0\uACB0\uC774 \uD574\uC81C\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC5F0\uACB0\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.';\r\n  } catch (error) {\r\n    $('connection').textContent = error.name === 'NotFoundError'\r\n      ? '\uBCF4\uB4DC \uC120\uD0DD\uC774 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.'\r\n      : `\uC5F0\uACB0/\uC218\uC2E0 \uC624\uB958 (${error.name}): ${error.message}. USB \uC5F0\uACB0\uACFC PC \uC808\uC804 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uACE0, \uC2DC\uB9AC\uC5BC \uBAA8\uB2C8\uD130\uB97C \uB2EB\uC740 \uB4A4 \uB2E4\uC2DC \uC5F0\uACB0\uD558\uC138\uC694.`;\r\n  } finally {\r\n    connected = false;\r\n    session.finish(performance.now());\r\n    reader?.releaseLock();\r\n    reader = null;\r\n    if (port) { try { await port.close(); } catch { /* \uC774\uBBF8 \uBD84\uB9AC\uB41C USB \uC7A5\uCE58 */ } }\r\n    port = null;\r\n    busy = false;\r\n    closing = false;\r\n    $('connect').disabled = false;\r\n    $('connect').textContent = '\uC544\uB450\uC774\uB178 \uC5F0\uACB0';\r\n    refresh();\r\n  }\r\n}\r\n\r\nasync function autoConnect() {\r\n  if (busy || connected || closing) return;\r\n  try {\r\n    const ports = await navigator.serial.getPorts();\r\n    if (busy || connected || closing) return;\r\n    let preferred = null;\r\n    try { preferred = localStorage.getItem('shot-port-identity'); } catch { /* \uC800\uC7A5\uC18C \uC0AC\uC6A9 \uBD88\uAC00 */ }\r\n    const candidate = chooseAutomaticPort(ports, preferred);\r\n    if (candidate) {\r\n      void connectPort(candidate);\r\n    } else {\r\n      $('connection').textContent = ports.length > 1\r\n        ? '\uD5C8\uC6A9\uB41C \uC7A5\uCE58\uAC00 \uC5EC\uB7EC \uAC1C\uC785\uB2C8\uB2E4. \uC544\uB450\uC774\uB178 \uC5F0\uACB0\uC744 \uB20C\uB7EC \uC0AC\uC6A9\uD560 \uD3EC\uD2B8\uB97C \uC120\uD0DD\uD558\uC138\uC694.'\r\n        : '\uC790\uB3D9 \uC5F0\uACB0\uD560 \uC544\uB450\uC774\uB178\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. USB \uC5F0\uACB0\uC744 \uD655\uC778\uD558\uACE0 \uCC98\uC74C \uD55C \uBC88 \uC544\uB450\uC774\uB178 \uC5F0\uACB0\uC744 \uB20C\uB7EC \uD5C8\uC6A9\uD574\uC8FC\uC138\uC694.';\r\n    }\r\n  } catch (error) {\r\n    if (!busy && !connected) $('connection').textContent = `\uC790\uB3D9 \uC5F0\uACB0 \uD655\uC778 \uC2E4\uD328: ${error.message}. \uC544\uB450\uC774\uB178 \uC5F0\uACB0 \uBC84\uD2BC\uC73C\uB85C \uC5F0\uACB0\uD558\uC138\uC694.`;\r\n  }\r\n}\r\n\r\nfunction extractionDate(date) {\r\n  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;\r\n}\r\n\r\nfunction createRecordImage() {\r\n  draw();\r\n  const record = document.createElement('canvas');\r\n  record.width = 1200;\r\n  const context = record.getContext('2d');\r\n  context.font = '22px system-ui';\r\n  const lines = [];\r\n  const notes = $('notes').value.trim().replace(/\\n{3,}/g, '\\n\\n') || '\uBA54\uBAA8 \uC5C6\uC74C';\r\n  for (const paragraph of notes.split('\\n')) {\r\n    let line = '';\r\n    for (const character of paragraph) {\r\n      if (context.measureText(line + character).width > record.width - 80) {\r\n        lines.push(line); line = '';\r\n      }\r\n      line += character;\r\n    }\r\n    lines.push(line);\r\n  }\r\n  const graphHeight = Math.round(canvas.height / canvas.width * record.width);\r\n  record.height = 100 + graphHeight + 80 + lines.length * 32;\r\n  context.fillStyle = '#192331'; context.fillRect(0, 0, record.width, record.height);\r\n  context.fillStyle = '#e6edf6'; context.font = 'bold 28px system-ui';\r\n  context.fillText('\uCD94\uCD9C \uAE30\uB85D', 40, 42);\r\n  context.font = '20px system-ui';\r\n  context.fillText(`\uCD94\uCD9C \uC2DC\uC791: ${session.startedDate.toLocaleString('ko-KR', { hour12: false })}`, 40, 76);\r\n  context.drawImage(canvas, 0, 100, record.width, graphHeight);\r\n  context.font = 'bold 22px system-ui';\r\n  context.fillText('\uCD94\uCD9C \uBA54\uBAA8', 40, 100 + graphHeight + 38);\r\n  context.font = '22px system-ui';\r\n  lines.forEach((line, i) => context.fillText(line, 40, 100 + graphHeight + 76 + i * 32));\r\n  return record;\r\n}\r\n\r\n$('download').addEventListener('click', async () => {\r\n  if ($('download').disabled) return;\r\n  saving = true;\r\n  const startedDate = session.startedDate;\r\n  const date = extractionDate(startedDate);\r\n  $('save-status').textContent = '\uADF8\uB798\uD504\uC640 \uBA54\uBAA8\uB97C \uC800\uC7A5\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4\u2026';\r\n  refresh();\r\n  try {\r\n    const notes = $('notes').value;\r\n    const record = createRecordImage();\r\n    const blob = await new Promise(resolve => record.toBlob(resolve, 'image/png'));\r\n    if (!blob) throw new Error('\uC774\uBBF8\uC9C0\uB97C \uB9CC\uB4E4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.');\r\n    const response = await fetch(`/api/extractions?date=${date}`, {\r\n      method: 'POST',\r\n      headers: {\r\n        'Content-Type': 'image/png',\r\n        'X-Shot-Save': '1',\r\n        'X-Shot-Notes': encodeURIComponent(notes),\r\n        'X-Shot-Started-At': startedDate.toISOString(),\r\n      },\r\n      body: blob,\r\n    });\r\n    if (response.status === 404 || response.status === 501) {\r\n      throw new Error('\uCD5C\uC2E0 Open_Graph.bat\uB85C \uC11C\uBC84\uB97C \uB2E4\uC2DC \uC2E4\uD589\uD574\uC8FC\uC138\uC694.');\r\n    }\r\n    const result = await response.json();\r\n    if (!response.ok) throw new Error(result.error || '\uD30C\uC77C\uC744 \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.');\r\n    $('save-status').textContent = `\uC800\uC7A5 \uC644\uB8CC: ${result.path}`;\r\n    await loadHistory();\r\n  } catch (error) {\r\n    $('save-status').textContent = `\uC800\uC7A5 \uC2E4\uD328: ${error.message}`;\r\n  } finally {\r\n    saving = false;\r\n    refresh();\r\n  }\r\n});\r\n\r\nlet historyRequest = 0;\r\nlet activePreview = null;\r\nconst ordersFrame = $('orders-frame');\r\nconst graphView = document.querySelector('main');\r\nconst previewDialog = $('history-preview');\r\nlet ordersLoaded = false;\r\nlet pendingOrderFilename = null;\r\n\r\nfunction notifyOrders() {\r\n  ordersFrame.contentWindow.postMessage({\r\n    type: 'shot:show-orders', filename: pendingOrderFilename,\r\n  }, location.origin);\r\n  pendingOrderFilename = null;\r\n}\r\n\r\nfunction openOrders(filename = null) {\r\n  pendingOrderFilename = filename;\r\n  if (previewDialog.open) previewDialog.close();\r\n  graphView.hidden = true;\r\n  ordersFrame.hidden = false;\r\n  if (!ordersFrame.hasAttribute('src')) ordersFrame.src = '/orders/';\r\n  else if (ordersLoaded) notifyOrders();\r\n}\r\n\r\nordersFrame.addEventListener('load', () => {\r\n  if (!ordersFrame.hasAttribute('src')) return;\r\n  ordersLoaded = true;\r\n  if (!ordersFrame.hidden) notifyOrders();\r\n});\r\nwindow.addEventListener('message', event => {\r\n  if (event.origin !== location.origin || event.source !== ordersFrame.contentWindow\r\n      || event.data?.type !== 'shot:show-graph') return;\r\n  ordersFrame.hidden = true;\r\n  graphView.hidden = false;\r\n  refresh();\r\n  void loadHistory();\r\n  $('open-orders').focus();\r\n});\r\n$('open-orders').addEventListener('click', () => openOrders());\r\n$('preview-order').addEventListener('click', () => {\r\n  if (activePreview) openOrders(activePreview.filename);\r\n});\r\n\r\nfunction historyDefaultTitle(record) {\r\n  return `${record.date} \xB7 \uCD94\uCD9C #${String(record.number).padStart(3, '0')}`;\r\n}\r\n\r\nasync function showHistoryRecord(record) {\r\n  const preview = { filename: record.filename, url: `/api/extractions/notes/${encodeURIComponent(record.filename)}` };\r\n  activePreview = preview;\r\n  preview.title = record.title;\r\n  $('edit-record-title').textContent = record.title || historyDefaultTitle(record);\r\n  $('preview-title').hidden = false;\r\n  $('history-title-form').hidden = true;\r\n  $('history-record-title').placeholder = historyDefaultTitle(record);\r\n  $('history-title-form').querySelector('button').disabled = false;\r\n  $('history-title-status').textContent = '';\r\n  $('preview-status').textContent = '';\r\n  $('preview-image').src = record.url;\r\n  $('preview-download').href = record.url;\r\n  $('preview-download').download = record.filename;\r\n  $('history-notes').value = '';\r\n  $('history-notes').disabled = true;\r\n  $('history-notes-save').disabled = true;\r\n  $('history-notes-status').textContent = '\uBA54\uBAA8\uB97C \uBD88\uB7EC\uC624\uB294 \uC911\u2026';\r\n  $('history-preview').showModal();\r\n  try {\r\n    const response = await fetch(preview.url);\r\n    const result = await response.json();\r\n    if (!response.ok) throw new Error(result.error);\r\n    if (activePreview !== preview) return;\r\n    $('history-notes').value = result.notes ?? '';\r\n    $('history-notes-status').textContent = result.notes === null\r\n      ? '\uAE30\uC874 \uBA54\uBAA8\uB294 \uC544\uB798 \uC6D0\uBCF8 \uC774\uBBF8\uC9C0\uC5D0 \uC788\uC2B5\uB2C8\uB2E4. \uB0B4\uC6A9\uC744 \uC62E\uAE30\uAC70\uB098 \uC0C8 \uBA54\uBAA8\uB97C \uC791\uC131\uD558\uC138\uC694.'\r\n      : '\uC218\uC815\uD55C \uBA54\uBAA8\uB294 \uC774 \uAE30\uB85D\uC5D0 \uBCC4\uB3C4\uB85C \uC800\uC7A5\uB429\uB2C8\uB2E4.';\r\n    $('history-notes').disabled = false;\r\n    $('history-notes-save').disabled = false;\r\n  } catch (error) {\r\n    if (activePreview === preview) $('history-notes-status').textContent = `\uBA54\uBAA8\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. ${error.message}`;\r\n  }\r\n}\r\n\r\n$('history-notes-save').addEventListener('click', async () => {\r\n  const preview = activePreview;\r\n  if (!preview || $('history-notes-save').disabled) return;\r\n  const notes = $('history-notes').value;\r\n  $('history-notes').disabled = true;\r\n  $('history-notes-save').disabled = true;\r\n  $('history-notes-status').textContent = '\uBA54\uBAA8 \uC800\uC7A5 \uC911\u2026';\r\n  try {\r\n    const response = await fetch(preview.url, {\r\n      method: 'POST',\r\n      headers: { 'Content-Type': 'application/json', 'X-Shot-Save': '1' },\r\n      body: JSON.stringify(notes),\r\n    });\r\n    const result = await response.json();\r\n    if (!response.ok) throw new Error(result.error);\r\n    if (activePreview === preview) $('history-notes-status').textContent = '\uBA54\uBAA8\uB97C \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.';\r\n  } catch (error) {\r\n    if (activePreview === preview) $('history-notes-status').textContent = `\uBA54\uBAA8\uB97C \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. ${error.message}`;\r\n  } finally {\r\n    if (activePreview === preview) {\r\n      $('history-notes').disabled = false;\r\n      $('history-notes-save').disabled = false;\r\n    }\r\n  }\r\n});\r\n\r\nfunction closeTitleEditor() {\r\n  $('history-title-form').hidden = true;\r\n  $('preview-title').hidden = false;\r\n  $('edit-record-title').focus();\r\n}\r\n\r\n$('edit-record-title').addEventListener('click', () => {\r\n  const input = $('history-record-title');\r\n  input.value = activePreview?.title || input.placeholder;\r\n  $('history-title-status').textContent = '';\r\n  $('preview-title').hidden = true;\r\n  $('history-title-form').hidden = false;\r\n  input.focus();\r\n  input.select();\r\n});\r\n$('cancel-record-title').addEventListener('click', closeTitleEditor);\r\n$('history-title-form').addEventListener('keydown', event => {\r\n  if (event.key !== 'Escape') return;\r\n  event.preventDefault();\r\n  closeTitleEditor();\r\n});\r\n$('history-title-form').addEventListener('submit', async event => {\r\n  event.preventDefault();\r\n  const preview = activePreview;\r\n  if (!preview) return;\r\n  const input = $('history-record-title');\r\n  const submit = event.currentTarget.querySelector('button');\r\n  if (submit.disabled) return;\r\n  submit.disabled = true;\r\n  try {\r\n    const title = input.value.trim();\r\n    const response = await fetch('/api/extractions/title/' + encodeURIComponent(preview.filename), {\r\n      method: 'POST',\r\n      headers: { 'Content-Type': 'application/json', 'X-Shot-Save': '1' },\r\n      body: JSON.stringify(title === input.placeholder ? '' : title),\r\n    });\r\n    const result = await response.json();\r\n    if (!response.ok) throw new Error(result.error);\r\n    if (activePreview === preview) {\r\n      preview.title = result.title;\r\n      $('edit-record-title').textContent = result.title || input.placeholder;\r\n      $('history-title-status').textContent = '\uC81C\uBAA9\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.';\r\n      if (!$('history-title-form').hidden) closeTitleEditor();\r\n    }\r\n    await loadHistory();\r\n  } catch (error) {\r\n    if (activePreview === preview) $('history-title-status').textContent = error.message;\r\n  } finally {\r\n    if (activePreview === preview) submit.disabled = false;\r\n  }\r\n});\r\n\r\nasync function loadHistory() {\r\n  const request = ++historyRequest;\r\n  $('history-refresh').disabled = true;\r\n  $('history-status').textContent = '\uC800\uC7A5\uB41C \uCD94\uCD9C \uAE30\uB85D\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\u2026';\r\n  try {\r\n    const response = await fetch('/api/extractions', { cache: 'no-store' });\r\n    if (response.status === 404 || response.status === 501) {\r\n      throw new Error('\uCD5C\uC2E0 Open_Graph.bat\uB85C \uB2E4\uC2DC \uC2E4\uD589\uD574\uC8FC\uC138\uC694.');\r\n    }\r\n    const result = await response.json();\r\n    if (!response.ok) throw new Error(result.error || '\uAE30\uB85D\uC744 \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.');\r\n    if (request !== historyRequest) return;\r\n    const list = document.createDocumentFragment();\r\n    for (const record of result.records) {\r\n      const button = document.createElement('button');\r\n      button.className = 'history-card';\r\n      const original = historyDefaultTitle(record);\r\n      const title = record.title || original;\r\n      button.setAttribute('aria-label', `${title} \uBCF4\uAE30`);\r\n      const image = document.createElement('img');\r\n      image.src = record.url; image.alt = ''; image.loading = 'lazy';\r\n      const label = document.createElement('span'); label.textContent = title;\r\n      const hint = document.createElement('small'); hint.textContent = record.title ? original : '\uADF8\uB798\uD504 \uBCF4\uAE30 \xB7 \uC81C\uBAA9 \uBC0F \uBA54\uBAA8 \uD3B8\uC9D1';\r\n      button.append(image, label, hint);\r\n      button.addEventListener('click', () => showHistoryRecord(record));\r\n      list.append(button);\r\n    }\r\n    $('history-list').replaceChildren(list);\r\n    $('history-status').textContent = result.records.length\r\n      ? `\uC800\uC7A5\uB41C \uAE30\uB85D ${result.records.length}\uAC1C \xB7 \uCD5C\uC2E0\uC21C`\r\n      : '\uC800\uC7A5\uB41C \uAE30\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uCD94\uCD9C \uC644\uB8CC \uD6C4 \uC774\uBBF8\uC9C0 \uC800\uC7A5\uC744 \uB20C\uB7EC\uC8FC\uC138\uC694.';\r\n  } catch (error) {\r\n    if (request === historyRequest) $('history-status').textContent = `\uBD88\uB7EC\uC624\uAE30 \uC2E4\uD328: ${error.message}`;\r\n  } finally {\r\n    if (request === historyRequest) $('history-refresh').disabled = false;\r\n  }\r\n}\r\n\r\n$('history-refresh').addEventListener('click', loadHistory);\r\n$('preview-close').addEventListener('click', () => previewDialog.close());\r\nlet pointerStartedOutside = false;\r\nfunction isPreviewBackdrop(event) {\r\n  const bounds = previewDialog.getBoundingClientRect();\r\n  return event.target === previewDialog && (event.clientX < bounds.left || event.clientX >= bounds.right\r\n    || event.clientY < bounds.top || event.clientY >= bounds.bottom);\r\n}\r\npreviewDialog.addEventListener('pointerdown', event => { pointerStartedOutside = isPreviewBackdrop(event); });\r\npreviewDialog.addEventListener('click', event => {\r\n  if (pointerStartedOutside && isPreviewBackdrop(event)) previewDialog.close();\r\n});\r\npreviewDialog.addEventListener('close', () => { activePreview = null; pointerStartedOutside = false; });\r\n$('preview-image').addEventListener('error', () => {\r\n  $('preview-status').textContent = '\uC774\uBBF8\uC9C0\uB97C \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uD30C\uC77C\uC774 \uC0AD\uC81C\uB418\uAC70\uB098 \uC774\uB3D9\uD588\uB294\uC9C0 \uD655\uC778\uD558\uACE0 \uD788\uC2A4\uD1A0\uB9AC\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.';\r\n});\r\n\r\nif (!('serial' in navigator) || !window.isSecureContext) {\r\n  $('connect').disabled = true;\r\n  document.body.classList.add('serial-unavailable');\r\n  $('connection').textContent = '\uC800\uC7A5\uB41C \uCD94\uCD9C \uAE30\uB85D\uACFC \uC8FC\uBB38\uC744 \uBCFC \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uC2E4\uC2DC\uAC04 \uC555\uB825 \uCE21\uC815\uC740 Arduino\uB97C \uC5F0\uACB0\uD55C PC\uC758 Chrome \uB610\uB294 Edge\uC5D0\uC11C \uC774\uC6A9\uD558\uC138\uC694.';\r\n} else {\r\n  navigator.serial.addEventListener('connect', autoConnect);\r\n  void autoConnect();\r\n}\r\nsetInterval(refresh, 100);\r\nrefresh();\r\nloadHistory();\r\n", "text/javascript"], "/autoconnect.mjs": ["export function portIdentity(port) {\r\n  const info = port.getInfo?.() ?? {};\r\n  return JSON.stringify([info.usbVendorId ?? null, info.usbProductId ?? null]);\r\n}\r\n\r\nexport function chooseAutomaticPort(ports, preferredIdentity) {\r\n  const matches = preferredIdentity\r\n    ? ports.filter(port => portIdentity(port) === preferredIdentity)\r\n    : ports;\r\n  // Identical USB adapters cannot be distinguished by getInfo. Ask the user.\r\n  return matches.length === 1 ? matches[0] : null;\r\n}\r\n", "text/javascript"], "/persistence.mjs": ["import { ExtractionSession } from './session.mjs?v=2026-11-04-r2';\r\n\r\nconst KEY = 'shot-completed-record-v1';\r\n\r\nexport function restoreCompleted(storage, now, wallNow) {\r\n  const fallback = { session: new ExtractionSession(), notes: '' };\r\n  try {\r\n    const record = JSON.parse(storage.getItem(KEY));\r\n    if (!record || record.version !== 1 || !Number.isFinite(record.endedWallAt)\r\n        || !Number.isFinite(record.durationMs) || record.durationMs < 0\r\n        || !Number.isFinite(record.peakPressure) || !Array.isArray(record.points)\r\n        || record.points.some(p => !Number.isFinite(p.time) || p.time < 0 || !Number.isFinite(p.pressure) || p.pressure < 0)\r\n        || !Number.isFinite(Date.parse(record.startedDate))) return fallback;\r\n    const session = new ExtractionSession();\r\n    session.state = 'completed';\r\n    session.endedAt = now - Math.max(0, wallNow - record.endedWallAt);\r\n    session.startedAt = session.endedAt - record.durationMs;\r\n    session.startedDate = new Date(record.startedDate);\r\n    session.points = record.points;\r\n    session.peakPressure = record.peakPressure;\r\n    session.completionReason = record.completionReason;\r\n    session.armed = false;\r\n    return { session, notes: typeof record.notes === 'string' ? record.notes : '' };\r\n  } catch {\r\n    return fallback;\r\n  }\r\n}\r\n\r\nexport function persistCompleted(storage, session, now, wallNow, notes) {\r\n  if (session.state !== 'completed') {\r\n    storage.removeItem(KEY);\r\n    return;\r\n  }\r\n  storage.setItem(KEY, JSON.stringify({\r\n    version: 1,\r\n    endedWallAt: wallNow - (now - session.endedAt),\r\n    durationMs: session.endedAt - session.startedAt,\r\n    startedDate: session.startedDate.toISOString(),\r\n    points: session.points,\r\n    peakPressure: session.peakPressure,\r\n    completionReason: session.completionReason,\r\n    notes,\r\n  }));\r\n}\r\n", "text/javascript"], "/serial.mjs": ["import { PressureLines } from './session.mjs?v=2026-11-04-r2';\r\n\r\n// Web Serial recreates readable after recoverable framing/overrun errors.\r\n// Reacquire the reader without reopening the port (which may reset the board).\r\nexport async function receivePressure(port, { onPressure, onReader, onReadError, shouldStop }) {\r\n  let failures = 0;\r\n  while (!shouldStop() && port.readable) {\r\n    const reader = port.readable.getReader();\r\n    onReader(reader);\r\n    const decoder = new TextDecoder();\r\n    const lines = new PressureLines(pressure => {\r\n      failures = 0;\r\n      onPressure(pressure);\r\n    });\r\n    let retry = false;\r\n    try {\r\n      while (!shouldStop()) {\r\n        const { value, done } = await reader.read();\r\n        if (done) return;\r\n        lines.push(decoder.decode(value, { stream: true }));\r\n      }\r\n    } catch (error) {\r\n      if (shouldStop()) return;\r\n      if (!port.readable || ++failures > 3) throw error;\r\n      onReadError(error, failures);\r\n      retry = true;\r\n    } finally {\r\n      reader.releaseLock();\r\n      onReader(null);\r\n    }\r\n    if (retry) await new Promise(resolve => setTimeout(resolve, 250));\r\n  }\r\n}\r\n", "text/javascript"], "/session.mjs": ["export const AUTO_START_BAR = 1.0;\r\nexport const AUTO_FINISH_DROP_BAR_PER_SECOND = 2.0;\r\nexport const REARM_PRESSURE_BAR = 1.0;\r\nexport const REARM_STABLE_MS = 1000;\r\nexport const RESTART_COOLDOWN_MS = 30000;\r\n\r\nexport class ExtractionSession {\r\n  constructor() {\r\n    this.state = 'waiting';\r\n    this.pressure = null;\r\n    this.points = [];\r\n    this.startedAt = null;\r\n    this.endedAt = null;\r\n    this.armed = true;\r\n    this.peakPressure = null;\r\n    this.startedDate = null;\r\n    this.completionReason = null;\r\n    this.slopeSample = null;\r\n    this.rearmLowSince = null;\r\n    this.lastRearmSampleAt = null;\r\n  }\r\n\r\n  start(now) {\r\n    if (this.state === 'recording' || this.cooldownRemainingMs(now) > 0) return;\r\n    this.state = 'recording';\r\n    this.startedAt = now;\r\n    this.startedDate = new Date();\r\n    this.peakPressure = this.pressure;\r\n    this.endedAt = null;\r\n    this.points = [];\r\n    this.armed = false;\r\n    this.rearmLowSince = null;\r\n    this.lastRearmSampleAt = null;\r\n    this.completionReason = null;\r\n    this.slopeSample = this.pressure === null ? null : { pressure: this.pressure, at: now };\r\n    if (this.pressure !== null) this.points.push({ time: 0, pressure: this.pressure });\r\n  }\r\n\r\n  finish(now, reason = 'manual') {\r\n    if (this.state !== 'recording') return;\r\n    this.endedAt = now;\r\n    this.state = 'completed';\r\n    this.completionReason = reason;\r\n    // A completed shot remains locked until pressure has settled at or below the restart threshold.\r\n    this.armed = false;\r\n    this.rearmLowSince = null;\r\n    this.lastRearmSampleAt = null;\r\n  }\r\n\r\n  ingest(pressure, now) {\r\n    if (!Number.isFinite(pressure) || pressure < 0) return;\r\n    this.pressure = pressure;\r\n    if (this.cooldownRemainingMs(now) > 0) return;\r\n    if (this.state !== 'recording') {\r\n      if (this.state === 'completed' && !this.armed) {\r\n        if (pressure <= REARM_PRESSURE_BAR) {\r\n          const gap = this.lastRearmSampleAt === null ? null : now - this.lastRearmSampleAt;\r\n          if (this.rearmLowSince === null || gap === null || gap > 1000 || gap < 0) {\r\n            this.rearmLowSince = now;\r\n          }\r\n          if (now - this.rearmLowSince >= REARM_STABLE_MS) this.armed = true;\r\n        } else {\r\n          this.rearmLowSince = null;\r\n        }\r\n        this.lastRearmSampleAt = now;\r\n      }\r\n      if (pressure > AUTO_START_BAR && this.armed) {\r\n        this.start(now);\r\n        return;\r\n      }\r\n    }\r\n    if (this.state === 'recording') {\r\n      this.points.push({ time: this.elapsed(now), pressure });\r\n      this.peakPressure = Math.max(this.peakPressure ?? pressure, pressure);\r\n      const previous = this.slopeSample;\r\n      const interval = previous === null ? null : now - previous.at;\r\n      // Ignore near-simultaneous buffered lines and gaps in reception.\r\n      // At the normal 5 Hz rate, a 0.4 bar drop over 200 ms completes a shot.\r\n      if (previous && interval >= 100 && interval <= 1000\r\n          && (previous.pressure - pressure) * 1000 >= AUTO_FINISH_DROP_BAR_PER_SECOND * interval) {\r\n        this.finish(now, 'pressure-drop');\r\n      }\r\n      if (previous === null || interval >= 100 || interval < 0) {\r\n        this.slopeSample = { pressure, at: now };\r\n      }\r\n    }\r\n  }\r\n\r\n  elapsed(now) {\r\n    return this.startedAt === null ? 0 : ((this.endedAt ?? now) - this.startedAt) / 1000;\r\n  }\r\n\r\n  cooldownRemainingMs(now) {\r\n    if (this.state !== 'completed' || this.endedAt === null) return 0;\r\n    return Math.max(0, RESTART_COOLDOWN_MS - (now - this.endedAt));\r\n  }\r\n}\r\n\r\n// USB \uC77D\uAE30\uB294 \uD55C \uC904\uC744 \uC5EC\uB7EC \uC870\uAC01\uC73C\uB85C \uB098\uB204\uAC70\uB098 \uC5EC\uB7EC \uC904\uC744 \uD55C \uBC88\uC5D0 \uBC18\uD658\uD560 \uC218 \uC788\uB2E4.\r\nexport class PressureLines {\r\n  constructor(onPressure) {\r\n    this.buffer = '';\r\n    this.onPressure = onPressure;\r\n  }\r\n\r\n  push(chunk) {\r\n    this.buffer += chunk;\r\n    const lines = this.buffer.split('\\n');\r\n    this.buffer = lines.pop();\r\n    if (this.buffer.length > 128) this.buffer = '';\r\n    for (const line of lines) {\r\n      const value = line.trim();\r\n      if (!/^\\d+(\\.\\d+)?$/.test(value)) continue;\r\n      const pressure = Number(value);\r\n      if (Number.isFinite(pressure)) this.onPressure(pressure);\r\n    }\r\n  }\r\n}\r\n", "text/javascript"], "/window.mjs": ["// Explicit close notifications avoid shutting down a throttled background tab.\r\nlet token = null;\r\nfunction opened() {\r\n  token = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');\r\n  void fetch('/api/window/open', {\r\n    method: 'POST', headers: { 'X-Shot-Save': '1' }, body: token, keepalive: true,\r\n  }).then(response => {\r\n    if (!response.ok) console.warn('\uC790\uB3D9 \uC885\uB8CC \uB4F1\uB85D \uC2E4\uD328: \uCD5C\uC2E0 \uC2E4\uD589 \uD504\uB85C\uADF8\uB7A8\uC73C\uB85C \uB2E4\uC2DC \uC2E4\uD589\uD574\uC8FC\uC138\uC694.');\r\n  }).catch(error => console.warn('\uC790\uB3D9 \uC885\uB8CC \uB4F1\uB85D \uC2E4\uD328:', error));\r\n}\r\nfunction closed() {\r\n  if (!token) return;\r\n  const closingToken = token;\r\n  token = null;\r\n  if (!navigator.sendBeacon('/api/window/close', closingToken)) {\r\n    void fetch('/api/window/close', { method: 'POST', body: closingToken, keepalive: true }).catch(() => {});\r\n  }\r\n}\r\nif (window === window.top) {\r\n  window.addEventListener('pageshow', opened);\r\n  window.addEventListener('pagehide', closed);\r\n}\r\n", "text/javascript"], "/orders/app.js": [`'use strict';\r
\r
const byId = id => document.getElementById(id);\r
const customerForm = byId('customer-form');\r
const extractForm = byId('extract-form');\r
const linkForm = byId('link-form');\r
const search = byId('search');\r
let records = {customers:[],extracts:[],customer_extracts:[]};\r
let tab = 'orders', selected = null, customerId = null, linkCustomerId = null;\r
let previewRecords = [], source = '', selectedPng = '';\r
let fileVersion = 0, busy = false;\r
\r
function node(tag, text, className) {\r
  const element = document.createElement(tag);\r
  if (text !== undefined) element.textContent = text;\r
  if (className) element.className = className;\r
  return element;\r
}\r
\r
function button(text, handler, className) {\r
  const el = node('button',text,className);\r
  el.type = 'button';\r
  el.addEventListener('click',handler);\r
  return el;\r
}\r
\r
function extractFields(data) {\r
  return Object.entries(data).filter(([key]) => !['__erp_png', '__shot_filename'].includes(key));\r
}\r
\r
function pngUrl(base64) {\r
  return 'data:image/png;base64,' + base64;\r
}\r
\r
function notice(text, error = false) {\r
  const el = byId('notice');\r
  el.textContent = text;\r
  el.hidden = !text;\r
  el.dataset.error = String(error);\r
}\r
\r
function formError(form, text) {\r
  const el = form.querySelector('.form-error');\r
  el.textContent = text;\r
  el.hidden = !text;\r
}\r
\r
async function copyShippingDetails(customer) {\r
  const text = [customer.name, customer.phone, customer.address]\r
    .map(value => value.trim()).filter(Boolean).join('\\n');\r
  try {\r
    await navigator.clipboard.writeText(text);\r
    notice('\uBC1B\uB294 \uBD84 \uC774\uB984, \uC5F0\uB77D\uCC98, \uC8FC\uC18C\uB97C \uBCF5\uC0AC\uD588\uC2B5\uB2C8\uB2E4.');\r
  } catch {\r
    notice('\uD074\uB9BD\uBCF4\uB4DC\uC5D0 \uBCF5\uC0AC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uBE0C\uB77C\uC6B0\uC800\uC758 \uD074\uB9BD\uBCF4\uB4DC \uAD8C\uD55C\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.',true);\r
  }\r
}\r
\r
async function api(url, body) {\r
  const options = body === undefined ? {} : {\r
    method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify(body)\r
  };\r
  const response = await fetch('/orders/api/' + url,options);\r
  const data = await response.json().catch(() => null);\r
  if (!response.ok || !data) throw new Error(data?.error || '\uC11C\uBC84\uC5D0 \uC5F0\uACB0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694.');\r
  return data;\r
}\r
\r
async function refresh() {\r
  const [stored, history] = await Promise.all([\r
    api('records'),\r
    fetch('/api/extractions').then(response => {\r
      if (!response.ok) throw new Error('\uCD94\uCD9C \uD788\uC2A4\uD1A0\uB9AC\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.');\r
      return response.json();\r
    }),\r
  ]);\r
  const registered = new Set(stored.extracts.map(record => record.id));\r
  const historyByFile = new Map(history.records.map(record => [record.filename, record]));\r
  const historyOnly = history.records.filter(record => !registered.has(record.orderExtractId)).map(record => ({\r
    id: record.orderExtractId,\r
    title: record.title || record.filename.replace(/\\.png$/, ''),\r
    source: record.filename,\r
    created_at: record.date,\r
    history: record,\r
    data: { __shot_filename: record.filename },\r
    historyOnly: true,\r
  }));\r
  const savedExtracts = stored.extracts.map(record => {\r
    const local = historyByFile.get(record.data.__shot_filename);\r
    return local ? { ...record, title: local.title || record.title, history: local } : record;\r
  });\r
  const sortDate = record => record.history?.date ?? record.created_at.slice(0,10);\r
  const sortTime = record => record.history?.timestamp ?? Date.parse(record.created_at) / 1000;\r
  const ordered = [...historyOnly, ...savedExtracts].sort((a,b) =>\r
    sortDate(b).localeCompare(sortDate(a)) || sortTime(b) - sortTime(a)\r
    || (b.history?.number ?? 0) - (a.history?.number ?? 0));\r
  records = { ...stored, extracts: ordered };\r
  render();\r
}\r
\r
async function registerExtract(id) {\r
  const record = records.extracts.find(extract => extract.id === id);\r
  if (record?.historyOnly) {\r
    const result = await api('shot-extract', { filename: record.source });\r
    return result.id;\r
  }\r
  return id || null;\r
}\r
\r
function showTab(next, id = null) {\r
  tab = next;\r
  selected = id;\r
  search.value = '';\r
  render();\r
  if (next === 'orders') return window.erpUi.activate();\r
}\r
\r
async function showRelatedOrders(kind, id) {\r
  try {\r
    await showTab('orders');\r
    await window.erpUi.openRelated(kind,id);\r
  } catch (error) { notice(error.message,true); }\r
}\r
\r
function select(id) {\r
  selected = id;\r
  render();\r
  if (matchMedia('(max-width:650px)').matches) byId('detail').scrollIntoView({block:'start'});\r
}\r
\r
function render() {\r
  const customerView = tab === 'customers';\r
  const orderView = tab === 'orders';\r
  byId('order-tab').setAttribute('aria-pressed',String(orderView));\r
  byId('customer-tab').setAttribute('aria-pressed', String(customerView));\r
  byId('extract-tab').setAttribute('aria-pressed', String(tab === 'extracts'));\r
  byId('customer-count').textContent = records.customers.length;\r
  byId('extract-count').textContent = records.extracts.length;\r
  byId('records-view').hidden = orderView;\r
  byId('erp-view').hidden = !orderView;\r
  if (orderView) return;\r
  byId('list-title').textContent = customerView ? '\uACE0\uAC1D \uBAA9\uB85D' : '\uCD94\uCD9C \uAE30\uB85D';\r
  byId('add-customer').hidden = !customerView;\r
  search.placeholder = customerView ? '\uC774\uB984 \uB610\uB294 \uC5F0\uB77D\uCC98 \uAC80\uC0C9' : '\uAE30\uB85D \uC774\uB984, \uCD9C\uCC98 \uB610\uB294 \uB0B4\uC6A9 \uAC80\uC0C9';\r
  search.setAttribute('aria-label',search.placeholder);\r
  const q = search.value.trim().toLowerCase();\r
  const digits = /^[\\d+ .()-]+$/.test(q) ? q.replace(/\\D/g,'') : '';\r
  const visible = records[tab].filter(record => {\r
    const fields = customerView ? [record.name,record.phone] : [record.title,record.source,JSON.stringify(extractFields(record.data))];\r
    return fields.some(value => value.toLowerCase().includes(q)) ||\r
      (customerView && digits && record.phone.replace(/\\D/g,'').includes(digits));\r
  });\r
  const list = byId('list');\r
  list.replaceChildren();\r
  if (!visible.length) list.append(node('p',q ? '\uAC80\uC0C9 \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.' :\r
    customerView ? '\uB4F1\uB85D\uB41C \uACE0\uAC1D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.' : '\uCD94\uAC00\uB41C \uCD94\uCD9C \uAE30\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.','empty'));\r
  for (const record of visible) {\r
    const el = button(customerView ? record.name : record.title,() => select(record.id),'record-button');\r
    el.setAttribute('aria-current',String(selected === record.id));\r
    const sub = customerView ? record.phone : record.source || record.created_at.slice(0,10);\r
    if (sub) el.append(node('small',sub));\r
    list.append(el);\r
  }\r
  const record = records[tab].find(item => item.id === selected);\r
  const detail = byId('detail');\r
  detail.replaceChildren();\r
  if (record) renderDetail(detail,record,customerView);\r
  else {\r
    detail.append(node('h2',customerView ? '\uACE0\uAC1D \uC0C1\uC138' : '\uCD94\uCD9C \uAE30\uB85D \uC0C1\uC138'));\r
    detail.append(node('p',customerView ? '\uACE0\uAC1D\uC744 \uC120\uD0DD\uD558\uBA74 \uACE0\uAC1D \uC815\uBCF4\uC640 \uC5F0\uACB0\uB41C \uCD94\uCD9C \uAE30\uB85D\uC774 \uD45C\uC2DC\uB429\uB2C8\uB2E4.' :\r
      '\uCD94\uCD9C \uAE30\uB85D\uC744 \uC120\uD0DD\uD558\uBA74 \uC6D0\uBCF8 \uD56D\uBAA9\uACFC \uC5F0\uACB0\uB41C \uACE0\uAC1D\uC774 \uD45C\uC2DC\uB429\uB2C8\uB2E4.','empty'));\r
  }\r
}\r
\r
function renderDetail(detail, record, customerView) {\r
  const header = node('div',undefined,'detail-head');\r
  detail.append(header);\r
  if (customerView) {\r
    header.append(node('h2',record.name));\r
    const actions = node('div',undefined,'actions');\r
    actions.append(button('\uC774 \uACE0\uAC1D\uC758 \uC8FC\uBB38',() => showRelatedOrders('customer',record.id)));\r
    actions.append(button('\uACE0\uAC1D \uC815\uBCF4 \uC218\uC815',() => openCustomer(record)));\r
    actions.append(button('\uC1A1\uC7A5\uC6A9 \uACE0\uAC1D \uC815\uBCF4 \uBCF5\uC0AC',() => copyShippingDetails(record)));\r
    const add = button('\uCD94\uCD9C \uAE30\uB85D \uC5F0\uACB0',() => openLink(record),'primary');\r
    add.disabled = records.extracts.length === 0;\r
    actions.append(add);\r
    header.append(actions);\r
    const data = node('dl',undefined,'contact');\r
    for (const [label,value] of [['\uC5F0\uB77D\uCC98',record.phone],['\uC8FC\uC18C',record.address]]) {\r
      const item = node('div');\r
      item.append(node('dt',label),node('dd',value || '\uBBF8\uC785\uB825'));\r
      data.append(item);\r
    }\r
    detail.append(data);\r
  } else {\r
    detail.append(node('p',record.source ? record.source + ' \xB7 ' + record.created_at.slice(0,10) : record.created_at.slice(0,10),'muted'));\r
    const filename = record.data.__shot_filename;\r
    const localGraph = typeof filename === 'string' && /^\\d{4}-\\d{2}-\\d{2}_\\d+\\.png$/.test(filename);\r
    header.append(extractTitleEditor(record, localGraph ? filename : null),\r
      button('\uAD00\uB828 \uC8FC\uBB38 \uBCF4\uAE30',() => showRelatedOrders('extract',record.id)));\r
    if (localGraph || record.data.__erp_png) {\r
      const image = node('img',undefined,'extract-image');\r
      image.src = localGraph ? '/api/extractions/files/' + filename : pngUrl(record.data.__erp_png);\r
      image.alt = record.title + ' \uCD94\uCD9C \uADF8\uB798\uD504';\r
      const download = node('a','\uC6D0\uBCF8 PNG \uB0B4\uB824\uBC1B\uAE30');\r
      download.href = image.src;\r
      download.download = /\\.png$/i.test(record.source) ? record.source : '\uCD94\uCD9C-\uADF8\uB798\uD504.png';\r
      detail.append(image,download);\r
      if (localGraph) image.addEventListener('error', () => {\r
        image.replaceWith(node('p', '\uC6D0\uBCF8 \uADF8\uB798\uD504\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. data \uD3F4\uB354\uC5D0 PNG \uD30C\uC77C\uC774 \uC788\uB294\uC9C0 \uD655\uC778\uD558\uC138\uC694.', 'muted'));\r
      });\r
    }\r
    const table = node('table');\r
    table.setAttribute('aria-label','\uCD94\uCD9C \uB370\uC774\uD130 \uD56D\uBAA9');\r
    for (const [key,value] of extractFields(record.data)) {\r
      const row = table.insertRow();\r
      const label = node('th',key);\r
      label.scope = 'row';\r
      row.append(label,node('td',typeof value === 'object' ? JSON.stringify(value,null,2) : String(value)));\r
    }\r
    detail.append(table);\r
  }\r
  const links = node('div',undefined,'divider');\r
  links.append(node('h3',customerView ? '\uC5F0\uACB0\uB41C \uCD94\uCD9C \uAE30\uB85D' : '\uC5F0\uACB0\uB41C \uACE0\uAC1D'));\r
  const items = records.customer_extracts.filter(link => customerView ? link.customer_id === record.id : link.extract_id === record.id);\r
  if (!items.length) links.append(node('p',customerView && !records.extracts.length ?\r
    '\uC0C1\uB2E8\uC5D0\uC11C \uCD94\uCD9C \uB370\uC774\uD130\uB97C \uCD94\uAC00\uD558\uBA74 \uC774 \uACE0\uAC1D\uC5D0\uAC8C \uC5F0\uACB0\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.' : '\uC544\uC9C1 \uC5F0\uACB0 \uB0B4\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.','empty'));\r
  for (const item of items) {\r
    const linked = customerView ? records.extracts.find(e => e.id === item.extract_id) :\r
      records.customers.find(c => c.id === item.customer_id);\r
    if (!linked) continue;\r
    const row = node('div',undefined,'link-row');\r
    const info = node('div');\r
    info.append(button(customerView ? linked.title : linked.name,() => showTab(customerView ? 'extracts' : 'customers',linked.id),'text-button'));\r
    info.append(node('p',item.linked_on + (item.quantity === null ? '' : ' \xB7 ' + item.quantity.toLocaleString('ko-KR') + '\uAC1C'),'muted'));\r
    if (item.note) info.append(node('p',item.note));\r
    const actions = node('div',undefined,'actions');\r
    actions.append(button('\uC5F0\uACB0 \uD574\uC81C',() => unlink(item.id)));\r
    row.append(info,actions);\r
    links.append(row);\r
  }\r
  detail.append(links);\r
}\r
\r
function extractTitleEditor(record, filename) {\r
  const editor = node('div',undefined,'record-title-editor');\r
  const heading = node('h2');\r
  const form = node('form',undefined,'actions');\r
  const input = node('input');\r
  input.type = 'text';\r
  input.setAttribute('aria-label','\uAE30\uB85D \uC81C\uBAA9');\r
  input.maxLength = filename ? 120 : 240;\r
  input.required = !filename;\r
  const title = button(record.title,() => {\r
    input.value = record.title;\r
    heading.hidden = true;\r
    form.hidden = false;\r
    input.focus();\r
    input.select();\r
  },'editable-title');\r
  title.title = '\uD074\uB9AD\uD558\uC5EC \uC81C\uBAA9 \uC218\uC815';\r
  heading.append(title);\r
  const save = node('button','\uC81C\uBAA9 \uC800\uC7A5');\r
  save.type = 'submit';\r
  function cancel() {\r
    form.hidden = true;\r
    heading.hidden = false;\r
    title.focus();\r
  }\r
  form.append(input,save,button('\uCDE8\uC18C',cancel));\r
  form.hidden = true;\r
  form.addEventListener('keydown',event => {\r
    if (event.key === 'Escape') cancel();\r
  });\r
  editor.append(heading,form);\r
  form.addEventListener('submit',async event => {\r
    event.preventDefault();\r
    if (save.disabled) return;\r
    save.disabled = true;\r
    try {\r
      if (filename) {\r
        const response = await fetch('/api/extractions/title/' + encodeURIComponent(filename), {\r
          method:'POST', headers:{'Content-Type':'application/json','X-Shot-Save':'1'},\r
          body:JSON.stringify(input.value),\r
        });\r
        const data = await response.json();\r
        if (!response.ok) throw new Error(data.error);\r
      } else {\r
        await api('rename-extract',{id:record.id,title:input.value});\r
      }\r
      await refresh();\r
      notice('\uC81C\uBAA9\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.');\r
    } catch (error) {\r
      notice(error.message,true);\r
    } finally {\r
      save.disabled = false;\r
    }\r
  });\r
  return editor;\r
}\r
\r
async function unlink(id) {\r
  if (busy || !confirm('\uC774 \uC5F0\uACB0\uC744 \uD574\uC81C\uD560\uAE4C\uC694? \uACE0\uAC1D\uACFC \uCD94\uCD9C \uAE30\uB85D\uC740 \uBCF4\uC874\uB429\uB2C8\uB2E4.')) return;\r
  busy = true;\r
  try {\r
    await api('unlink',{id});\r
    await refresh();\r
    notice('\uC5F0\uACB0\uC744 \uD574\uC81C\uD588\uC2B5\uB2C8\uB2E4.');\r
  } catch (error) { notice(error.message,true); }\r
  finally { busy = false; }\r
}\r
\r
function openCustomer(record) {\r
  customerId = record?.id ?? null;\r
  customerForm.reset();\r
  formError(customerForm,'');\r
  byId('customer-title').textContent = record ? '\uACE0\uAC1D \uC815\uBCF4 \uC218\uC815' : '\uACE0\uAC1D \uB4F1\uB85D';\r
  for (const key of ['name','phone','address']) customerForm.elements.namedItem(key).value = record?.[key] ?? '';\r
  byId('customer-dialog').showModal();\r
}\r
\r
function openLink(customer) {\r
  linkCustomerId = customer.id;\r
  linkForm.reset();\r
  formError(linkForm,'');\r
  byId('link-customer').textContent = customer.name + ' \uACE0\uAC1D';\r
  const select = linkForm.elements.namedItem('extract_id');\r
  select.replaceChildren(new Option('\uCD94\uCD9C \uAE30\uB85D \uC120\uD0DD',''));\r
  for (const item of records.extracts) {\r
    select.add(new Option(item.title + ' \xB7 ' + item.created_at.slice(0,10),item.id));\r
  }\r
  linkForm.elements.namedItem('linked_on').value = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());\r
  byId('link-dialog').showModal();\r
}\r
\r
function parseCsv(text) {\r
  const rows = [];\r
  let row = [], field = '', state = 'start';\r
  const endField = () => { row.push(field); field = ''; state = 'start'; };\r
  const endRow = () => { endField(); if (row.some(value => value !== '')) rows.push(row); row = []; };\r
  for (let index = 0; index < text.length; index++) {\r
    const char = text[index];\r
    if (state === 'quoted') {\r
      if (char === '"' && text[index+1] === '"') { field += '"'; index++; }\r
      else if (char === '"') state = 'closed';\r
      else field += char;\r
      continue;\r
    }\r
    if (char === ',' || char === '\\r' || char === '\\n') {\r
      if (char === ',') endField();\r
      else {\r
        endRow();\r
        if (char === '\\r' && text[index+1] === '\\n') index++;\r
      }\r
    } else if (char === '"' && state === 'start') state = 'quoted';\r
    else if (char === '"' || state === 'closed') throw new Error('CSV\uC758 \uB530\uC634\uD45C\uB97C \uD655\uC778\uD558\uC138\uC694.');\r
    else { state = 'plain'; field += char; }\r
  }\r
  if (state === 'quoted') throw new Error('CSV\uC758 \uB2EB\uB294 \uB530\uC634\uD45C\uAC00 \uBE60\uC838 \uC788\uC2B5\uB2C8\uB2E4.');\r
  endRow();\r
  const fields = rows.shift()?.map(field => field.trim());\r
  if (!fields?.length || fields.some(field => !field) || new Set(fields).size !== fields.length) {\r
    throw new Error('CSV \uCCAB \uD589\uC5D0\uB294 \uC911\uBCF5\uB418\uAC70\uB098 \uBE48 \uD56D\uBAA9 \uC774\uB984\uC774 \uC5C6\uC5B4\uC57C \uD569\uB2C8\uB2E4.');\r
  }\r
  return rows.map((values,index) => {\r
    if (values.length !== fields.length) throw new Error('CSV\uC758 ' + (index + 2) + '\uBC88\uC9F8 \uAE30\uB85D\uC5D0\uC11C \uC5F4 \uAC1C\uC218\uAC00 \uB9DE\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.');\r
    return Object.fromEntries(fields.map((field,i) => [field,values[i]]));\r
  });\r
}\r
\r
function decodeInput(text, filename) {\r
  const cleaned = text.replace(/^\\uFEFF/,'');\r
  if (!cleaned.trim()) throw new Error('\uD30C\uC77C\uC744 \uC120\uD0DD\uD558\uAC70\uB098 \uB0B4\uC6A9\uC744 \uC785\uB825\uD558\uC138\uC694.');\r
  if (/\\.json$/i.test(filename) || (!/\\.csv$/i.test(filename) && /^[{[]/.test(cleaned.trimStart()))) {\r
    let value;\r
    try { value = JSON.parse(cleaned); }\r
    catch { throw new Error('JSON \uBB38\uBC95\uC744 \uD655\uC778\uD558\uC138\uC694.'); }\r
    return Array.isArray(value) ? value : [value];\r
  }\r
  return parseCsv(cleaned);\r
}\r
\r
function invalidatePreview() {\r
  previewRecords = [];\r
  byId('save-extract').disabled = true;\r
  byId('import-preview').hidden = true;\r
  byId('preview-image').hidden = true;\r
  byId('preview-image').removeAttribute('src');\r
}\r
\r
function preview() {\r
  formError(extractForm,'');\r
  invalidatePreview();\r
  try {\r
    const fields = new FormData(extractForm);\r
    const text = String(fields.get('text'));\r
    if (new TextEncoder().encode(text).length > 7_000_000) throw new Error('\uC785\uB825 \uD30C\uC77C\uC744 7MB \uC774\uD558\uB85C \uB098\uB220 \uC8FC\uC138\uC694.');\r
    const stamp = /^(\\d{4}-\\d{2}-\\d{2})_(\\d+)\\.png$/i.exec(source);\r
    const data = selectedPng ? [{\r
      '\uC6D0\uBCF8 \uD30C\uC77C\uBA85':source, ...(stamp ? {'\uCD94\uCD9C\uC77C':stamp[1],'\uC21C\uBC88':stamp[2]} : {})\r
    }] : decodeInput(text,source);\r
    const name = String(fields.get('title')).trim() || source.replace(/\\.[^.]+$/,'').slice(0,200) || '\uCD94\uCD9C \uAE30\uB85D';\r
    if (!data.length || data.some(item => !item || typeof item !== 'object' || Array.isArray(item) || !Object.keys(item).length)) {\r
      throw new Error('\uD56D\uBAA9 \uC774\uB984\uACFC \uAC12\uC774 \uB4E4\uC5B4 \uC788\uB294 \uAE30\uB85D\uC744 \uD55C \uAC74 \uC774\uC0C1 \uC785\uB825\uD558\uC138\uC694.');\r
    }\r
    const encoder = new TextEncoder();\r
    if (data.some(item => encoder.encode(JSON.stringify(item)).length > 40000)) throw new Error('\uCD94\uCD9C \uAE30\uB85D \uD55C \uAC74\uC740 40KB\uAE4C\uC9C0 \uC800\uC7A5\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.');\r
    previewRecords = data.map((item,index) => ({\r
      title:data.length === 1 ? name : name + ' \xB7 ' + (index + 1), source,\r
      data:selectedPng ? {...item,__erp_png:selectedPng} : item\r
    }));\r
    byId('preview-title').textContent = data.length.toLocaleString('ko-KR') + '\uAC74 \xB7 \uCCAB \uBC88\uC9F8 \uAE30\uB85D \uBBF8\uB9AC\uBCF4\uAE30';\r
    byId('preview-data').textContent = JSON.stringify(data[0],null,2);\r
    if (selectedPng) {\r
      byId('preview-image').src = pngUrl(selectedPng);\r
      byId('preview-image').hidden = false;\r
    }\r
    byId('import-preview').hidden = false;\r
    byId('save-extract').disabled = false;\r
  } catch (error) { formError(extractForm,error.message); }\r
}\r
\r
function bindSubmit(form, action) {\r
  form.addEventListener('submit', async event => {\r
    event.preventDefault();\r
    if (busy) return;\r
    busy = true;\r
    const submit = form.querySelector('button[type=submit]');\r
    submit.disabled = true;\r
    formError(form,'');\r
    try {\r
      const after = await action(Object.fromEntries(new FormData(form)));\r
      form.closest('dialog').close();\r
      try { await refresh(); }\r
      catch { notice('\uC800\uC7A5\uC740 \uC644\uB8CC\uB410\uC9C0\uB9CC \uD654\uBA74\uC744 \uAC31\uC2E0\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD574 \uC8FC\uC138\uC694.',true); return; }\r
      after();\r
    } catch (error) { formError(form,error.message); }\r
    finally { busy = false; submit.disabled = form === extractForm && !previewRecords.length; }\r
  });\r
}\r
\r
bindSubmit(customerForm,async fields => {\r
  const result = await api('customers',{...fields,id:customerId});\r
  return () => { showTab('customers',result.id); notice('\uACE0\uAC1D \uC815\uBCF4\uB97C \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.'); };\r
});\r
bindSubmit(extractForm,async () => {\r
  if (!previewRecords.length) throw new Error('\uBA3C\uC800 \uCD94\uCD9C \uAE30\uB85D\uC744 \uBBF8\uB9AC\uBCF4\uC138\uC694.');\r
  const result = await api('extracts',{records:previewRecords});\r
  return () => { showTab('extracts'); notice(result.count + '\uAC74\uC758 \uCD94\uCD9C \uAE30\uB85D\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.'); };\r
});\r
bindSubmit(linkForm,async fields => {\r
  const extract_id = await registerExtract(fields.extract_id);\r
  await api('links',{...fields,extract_id,customer_id:linkCustomerId,quantity:fields.quantity ? Number(fields.quantity) : null});\r
  return () => notice('\uACE0\uAC1D\uACFC \uCD94\uCD9C \uAE30\uB85D\uC744 \uC5F0\uACB0\uD588\uC2B5\uB2C8\uB2E4.');\r
});\r
\r
async function downloadBackup() {\r
  byId('data-menu').open = false;\r
  const control = byId('backup');\r
  control.disabled = true;\r
  try {\r
    const snapshot = await api('backup');\r
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot)],{type:'application/json'}));\r
    const a = node('a');\r
    a.href = url;\r
    a.download = '\uC8FC\uBB38-ERP-\uBC31\uC5C5-' + new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()) + '.json';\r
    document.body.append(a);\r
    a.click();\r
    a.remove();\r
    setTimeout(() => URL.revokeObjectURL(url),1000);\r
    notice('\uC804\uCCB4 \uBC31\uC5C5 \uD30C\uC77C\uC744 \uB0B4\uB824\uBC1B\uC558\uC2B5\uB2C8\uB2E4.');\r
  } catch (error) { notice(error.message,true); }\r
  finally { control.disabled = false; }\r
}\r
\r
window.erpData = {\r
  getRecords: () => records, api, notice, refresh, registerExtract,\r
  openCustomer: id => showTab('customers',id),\r
  openExtract: id => showTab('extracts',id)\r
};\r
\r
byId('order-tab').addEventListener('click',() => {\r
  Promise.resolve(showTab('orders')).catch(error => notice(error.message,true));\r
});\r
byId('customer-tab').addEventListener('click',() => showTab('customers'));\r
byId('extract-tab').addEventListener('click',async () => {\r
  showTab('extracts');\r
  try { await refresh(); }\r
  catch (error) { notice(error.message,true); }\r
});\r
byId('return-to-graph').addEventListener('click',event => {\r
  if (window.parent === window) return;\r
  event.preventDefault();\r
  window.parent.postMessage({type:'shot:show-graph'},location.origin);\r
});\r
\r
window.addEventListener('message',async event => {\r
  if (window.parent === window || event.origin !== location.origin || event.source !== window.parent\r
      || event.data?.type !== 'shot:show-orders') return;\r
  try {\r
    await refresh();\r
    if (event.data.filename) {\r
      const record = records.extracts.find(item => item.data.__shot_filename === event.data.filename);\r
      if (!record) throw new Error('\uCD94\uCD9C \uD788\uC2A4\uD1A0\uB9AC\uC5D0\uC11C \uAE30\uB85D\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.');\r
      showTab('extracts', record.id);\r
    } else if (tab === 'orders') await window.erpUi.activate();\r
  } catch (error) { notice(error.message,true); }\r
});\r
byId('add-customer').addEventListener('click',() => openCustomer());\r
search.addEventListener('input',render);\r
byId('import-extract').addEventListener('click',() => {\r
  extractForm.reset();\r
  fileVersion++;\r
  source = '';\r
  selectedPng = '';\r
  byId('extract-text').disabled = false;\r
  invalidatePreview();\r
  formError(extractForm,'');\r
  byId('extract-dialog').showModal();\r
});\r
extractForm.addEventListener('input',invalidatePreview);\r
byId('preview').addEventListener('click',preview);\r
byId('extract-file').addEventListener('change',async event => {\r
  const file = event.target.files[0], version = ++fileVersion;\r
  if (!file) return;\r
  byId('extract-text').value = '';\r
  byId('extract-text').disabled = false;\r
  source = '';\r
  selectedPng = '';\r
  invalidatePreview();\r
  formError(extractForm,'');\r
  try {\r
    if (/\\.png$/i.test(file.name) || file.type === 'image/png') {\r
      if (file.size > 786432) throw new Error('PNG \uD30C\uC77C\uC740 768KiB\uAE4C\uC9C0 \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.');\r
      const bytes = new Uint8Array(await file.arrayBuffer());\r
      if (bytes.length < 24 || ![137,80,78,71,13,10,26,10].every((byte,index) => bytes[index] === byte)) {\r
        throw new Error('\uC62C\uBC14\uB978 PNG \uD30C\uC77C\uC744 \uC120\uD0DD\uD558\uC138\uC694.');\r
      }\r
      const encoded = bytes.toBase64 ? bytes.toBase64() : btoa(bytes.reduce((text,byte) => text + String.fromCharCode(byte),''));\r
      const image = new Image();\r
      image.src = pngUrl(encoded);\r
      try { await image.decode(); } catch { throw new Error('PNG \uC774\uBBF8\uC9C0\uB97C \uC5F4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uD30C\uC77C\uC744 \uD655\uC778\uD558\uC138\uC694.'); }\r
      if (version !== fileVersion) return;\r
      selectedPng = encoded;\r
      source = file.name;\r
      byId('extract-text').disabled = true;\r
      preview();\r
      return;\r
    }\r
    if (file.size > 7_000_000) throw new Error('\uC785\uB825 \uD30C\uC77C\uC744 7MB \uC774\uD558\uB85C \uB098\uB220 \uC8FC\uC138\uC694.');\r
    const text = await file.text();\r
    if (version !== fileVersion) return;\r
    if (text.includes('\\uFFFD')) throw new Error('\uD30C\uC77C\uC744 UTF-8\uB85C \uC800\uC7A5\uD55C \uB4A4 \uB2E4\uC2DC \uC120\uD0DD\uD558\uC138\uC694.');\r
    source = file.name;\r
    byId('extract-text').value = text;\r
    preview();\r
  } catch (error) { if (version === fileVersion) formError(extractForm,error.message); }\r
});\r
for (const el of document.querySelectorAll('[data-close]')) el.addEventListener('click',() => el.closest('dialog').close());\r
byId('backup').addEventListener('click',downloadBackup);\r
byId('restore').addEventListener('click',() => {\r
  byId('data-menu').open = false;\r
  byId('backup-file').click();\r
});\r
byId('backup-file').addEventListener('change',async event => {\r
  const file = event.target.files[0];\r
  event.target.value = '';\r
  if (!file || busy) return;\r
  busy = true;\r
  try {\r
    if (file.size > 12_000_000) throw new Error('\uC774 \uBC31\uC5C5 \uD30C\uC77C\uC740 \uD55C \uBC88\uC5D0 \uBD88\uB7EC\uC624\uAE30\uC5D0\uB294 \uB108\uBB34 \uD07D\uB2C8\uB2E4.');\r
    let saved;\r
    try { saved = JSON.parse(await file.text()); }\r
    catch { throw new Error('\uBC31\uC5C5 \uD30C\uC77C\uC758 JSON \uD615\uC2DD\uC744 \uD655\uC778\uD558\uC138\uC694.'); }\r
    const result = await api('restore',saved);\r
    await refresh();\r
    if (tab === 'orders') await window.erpUi.activate();\r
    notice(result.count ? result.count + '\uAC1C\uC758 \uAE30\uB85D\uC744 \uBD88\uB7EC\uC654\uC2B5\uB2C8\uB2E4.' : '\uCD94\uAC00\uD560 \uAE30\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uAE30\uC874 \uAE30\uB85D\uC740 \uC720\uC9C0\uB429\uB2C8\uB2E4.');\r
  } catch (error) { notice(error.message,true); }\r
  finally { busy = false; }\r
});\r
window.addEventListener('DOMContentLoaded',async () => {\r
  render();\r
  try {\r
    const url = new URL(location.href);\r
    const filename = url.searchParams.get('shot');\r
    if (filename) {\r
      const result = await api('shot-extract', { filename });\r
      url.searchParams.delete('shot');\r
      url.searchParams.set('extract', result.id);\r
      history.replaceState(null, '', url);\r
    }\r
    await refresh();\r
    const extract = url.searchParams.get('extract');\r
    if (extract && records.extracts.some(record => record.id === extract)) {\r
      showTab('extracts', extract);\r
      notice('\uC774 \uCD94\uCD9C \uAE30\uB85D\uC740 \uC8FC\uBB38\uC758 \uCD9C\uACE0 \uB0B4\uC5ED\uC5D0\uC11C \uC120\uD0DD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.');\r
    } else if (tab === 'orders') await window.erpUi.activate();\r
  } catch (error) { notice(error.message,true); }\r
});\r
`, "text/javascript"], "/orders/app.css": [':root{font-family:system-ui,"Malgun Gothic",sans-serif;color:#192938;background:#f3f6f9;color-scheme:light;--ink:#192938;--muted:#4c6073;--line:#d9e2eb;--brand:#164b94;--soft:#eaf1fc}\r\n*{box-sizing:border-box}\r\nbody{margin:0}\r\n[hidden]{display:none!important}\r\n:focus-visible{outline:3px solid #2869ca;outline-offset:3px}\r\nh1,h2,h3,p{margin:0;overflow-wrap:anywhere}\r\nh1{font-size:clamp(1.55rem,4vw,2.25rem);letter-spacing:-.055em}\r\nh2{font-size:1.15rem;letter-spacing:-.04em}\r\nh3{font-size:1rem}\r\np{line-height:1.55}\r\nheader{background:#132e50;color:white;padding:2rem 0}\r\nheader p{color:#d4e1f1;margin-top:.4rem}\r\n.wrap{width:min(1100px,calc(100% - 2rem));margin:auto}\r\n.top,.actions,.section-head,.detail-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.7rem}\r\n.actions{justify-content:flex-end}\r\nmain{padding-bottom:2rem}\r\nbutton,summary,input,textarea,select{font:inherit;color:inherit}\r\nbutton,summary,.graph-link{border:1px solid #bdcad8;border-radius:8px;background:#fff;color:#243d58;padding:.55rem .75rem;cursor:pointer;font-weight:650;white-space:nowrap}\r\nbutton:hover:not(:disabled),summary:hover,.graph-link:hover{background:var(--soft)}\r\n.graph-link{display:inline-flex;align-items:center;gap:.45rem;text-decoration:none}\r\n.graph-link-icon{display:block;position:relative;width:1em;height:1em;border:solid currentColor;border-width:0 0 1px 1px;color:var(--brand)}\r\n.graph-link-icon::before{content:"";position:absolute;inset:0 0 2px 2px;background:currentColor;clip-path:polygon(0 83%,38% 39%,64% 58%,90% 12%,100% 24%,68% 76%,41% 57%,9% 95%)}\r\n.record-title-editor{min-width:0}\r\n.record-title-editor .editable-title{border:0;background:transparent;color:inherit;font:inherit;padding:0;text-align:left;white-space:normal;overflow-wrap:anywhere}\r\n.record-title-editor .editable-title:hover{text-decoration:underline}\r\n.record-title-editor input{min-width:0;max-width:100%}\r\nbutton:disabled{opacity:.55;cursor:default}\r\n.primary{color:#fff;background:var(--brand);border-color:var(--brand)}\r\n.primary:hover:not(:disabled){background:#103c7a}\r\nheader .primary{color:#12335e;background:#d9eaff;border-color:#d9eaff}\r\nheader .primary:hover:not(:disabled){background:#edf5ff}\r\ndetails{position:relative}\r\nsummary{list-style:none}\r\nsummary::-webkit-details-marker{display:none}\r\n.menu{position:absolute;z-index:5;right:0;top:calc(100% + .35rem);padding:.35rem;background:#fff;border:1px solid var(--line);border-radius:9px;box-shadow:0 8px 22px #132e5026}\r\n.menu button{display:block;width:100%;text-align:left;border-color:transparent}\r\n.tabs{display:flex;gap:.35rem;padding:1rem 0 .75rem}\r\n.tabs button{background:transparent;border-color:transparent}\r\n.tabs button[aria-pressed=true]{background:var(--soft);border-color:#c8d8f2;color:var(--brand)}\r\n.tabs span{font-size:.88rem;margin-left:.3rem}\r\n.workspace{display:grid;grid-template-columns:minmax(245px,310px) minmax(0,1fr);gap:1rem;align-items:start}\r\n.panel{background:white;border:1px solid var(--line);border-radius:14px;box-shadow:0 3px 16px #132e500a;min-height:340px}\r\n.side-head,.detail{padding:1.15rem}\r\n.side-head{display:grid;gap:.8rem;border-bottom:1px solid var(--line)}\r\ninput,textarea,select{width:100%;min-width:0;border:1px solid #adbfce;border-radius:8px;padding:.55rem .65rem;background:#fff}\r\nselect{appearance:none;padding-right:1.75rem;background-image:linear-gradient(45deg,transparent 50%,#284560 50%),linear-gradient(135deg,#284560 50%,transparent 50%);background-position:calc(100% - 14px) 50%,calc(100% - 9px) 50%;background-size:5px 5px;background-repeat:no-repeat}\r\n.record-button{display:grid;gap:.25rem;width:100%;text-align:left;white-space:normal;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:.8rem 1.15rem;overflow-wrap:anywhere}\r\n.record-button:last-child{border-bottom:0;border-radius:0 0 14px 14px}\r\n.record-button[aria-current=true]{background:var(--soft);box-shadow:inset 3px 0 var(--brand);color:var(--brand)}\r\n.muted,.record-button small{color:var(--muted);font-size:.92rem;font-weight:400}\r\n.empty{color:var(--muted);padding:1rem 0}\r\n#list .empty{padding:1rem 1.15rem}\r\n.detail-head{align-items:start;margin-bottom:.75rem}\r\n.detail-head .actions button{font-size:.92rem}\r\n.contact{display:grid;gap:.3rem;margin:.85rem 0 1.2rem}\r\n.contact div{display:grid;grid-template-columns:5rem 1fr;gap:.5rem;padding:.35rem 0}\r\ndt{color:var(--muted);font-size:.9rem}\r\ndd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}\r\n.divider{border-top:1px solid var(--line);padding-top:1rem;margin-top:1rem}\r\n.link-row{display:flex;justify-content:space-between;align-items:flex-start;gap:.55rem;padding:.8rem 0;border-bottom:1px solid var(--line)}\r\n.link-row:last-child{border:0}\r\n.link-row p{white-space:pre-wrap}\r\n.link-row .actions{flex-shrink:0}\r\n.link-row button{font-size:.88rem}\r\n.text-button{background:transparent;border:0;padding:0;color:var(--brand);text-decoration:underline;white-space:normal;text-align:left;overflow-wrap:anywhere}\r\ntable{width:100%;border-collapse:collapse;margin-top:.65rem;table-layout:fixed;text-align:left}\r\nth,td{border:1px solid var(--line);padding:.5rem;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}\r\nth{background:#f5f8fc;width:33%;font-weight:600}\r\ndialog{width:min(560px,calc(100% - 2rem));border:1px solid #b5c7d9;border-radius:14px;color:var(--ink);padding:1.35rem;max-height:90vh}\r\ndialog::backdrop{background:#0e2439aa}\r\nform{display:grid;gap:.85rem}\r\nlabel{display:grid;gap:.3rem;font-weight:600;font-size:.95rem}\r\n.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:.65rem}\r\n#notice{padding:.75rem .9rem;margin-top:.85rem;border-radius:8px;background:#e6f4ed;color:#254b40}\r\n#notice[data-error=true],.form-error{color:#892b35}\r\n#notice[data-error=true]{background:#fae9eb}\r\npre{margin:.45rem 0 0;padding:.6rem;background:#f1f5f9;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:170px;overflow:auto}\r\n.extract-image{display:block;max-width:100%;height:auto;max-height:34rem;object-fit:contain;margin:.75rem 0;border:1px solid var(--line);border-radius:8px}\r\n@media(max-width:650px){.workspace{grid-template-columns:1fr}.panel{min-height:0}header{padding:1.35rem 0}.link-row{flex-wrap:wrap}.detail{min-height:180px}}\r\n@media(max-width:650px){\r\n  .top .actions{justify-content:flex-start}\r\n  .top .actions button,.top .actions summary,.graph-link,.tabs button,.detail-head .actions button{min-height:44px}\r\n  input,textarea,select{font-size:16px}\r\n  dialog{max-height:90dvh}\r\n}\r\n', "text/css"], "/orders/erp.js": ["'use strict';\r\n\r\n(() => {\r\n  const byId = id => document.getElementById(id);\r\n  const view = byId('erp-view');\r\n  if (!view) return;\r\n\r\n  const search = byId('erp-search');\r\n  const list = byId('erp-list');\r\n  const detail = byId('erp-detail');\r\n  const dialog = byId('erp-order-dialog');\r\n  const form = byId('erp-order-form');\r\n  const fields = byId('erp-order-fields');\r\n  const lines = byId('erp-lines');\r\n  const submit = byId('erp-save-order');\r\n  const dateFrom = byId('erp-date-from');\r\n  const dateTo = byId('erp-date-to');\r\n  const statusFilter = byId('erp-status-filter');\r\n  const paymentFilter = byId('erp-payment-filter');\r\n  const shippingFilter = byId('erp-shipping-filter');\r\n  const orderStates = ['\uC811\uC218','\uCC98\uB9AC \uC911','\uC644\uB8CC','\uCDE8\uC18C'];\r\n  const paymentStates = ['\uBBF8\uACB0\uC81C','\uBD80\uBD84 \uACB0\uC81C','\uACB0\uC81C \uC644\uB8CC'];\r\n  const shippingStates = ['\uCD9C\uACE0 \uB300\uAE30','\uBD80\uBD84 \uCD9C\uACE0','\uCD9C\uACE0 \uC644\uB8CC'];\r\n  const numberFormat = new Intl.NumberFormat('ko-KR');\r\n  const dateFormat = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});\r\n  const money = amount => numberFormat.format(amount) + '\uC6D0';\r\n  const count = amount => numberFormat.format(amount) + '\uAC74';\r\n  const base = () => window.erpData;\r\n  let data = {orders:[],items:[],shipments:[],feedback:[],services:[]};\r\n  let cache = {};\r\n  let selectedId = null;\r\n  let related = null;\r\n  let editing = null;\r\n  let refreshing = null;\r\n  let waiting = false;\r\n  let deletingOrder = false;\r\n  let ready = false;\r\n\r\n  function node(tag, text, className) {\r\n    const el = document.createElement(tag);\r\n    if (text !== undefined) el.textContent = text;\r\n    if (className) el.className = className;\r\n    return el;\r\n  }\r\n\r\n  function button(text, action, className) {\r\n    const el = node('button',text,className);\r\n    el.type = 'button';\r\n    el.addEventListener('click',action);\r\n    return el;\r\n  }\r\n\r\n  function appendOptions(select, choices, label) {\r\n    select.replaceChildren();\r\n    if (label) select.add(new Option(label,''));\r\n    for (const entry of choices) {\r\n      const [text,value] = Array.isArray(entry) ? entry : [entry,entry];\r\n      select.add(new Option(text,value));\r\n    }\r\n  }\r\n\r\n  appendOptions(statusFilter,orderStates,'\uC804\uCCB4');\r\n  appendOptions(paymentFilter,paymentStates,'\uC804\uCCB4');\r\n  appendOptions(shippingFilter,shippingStates,'\uC804\uCCB4');\r\n\r\n  function mapRows(rows, attribute) {\r\n    const result = new Map();\r\n    for (const row of rows) {\r\n      const group = result.get(row[attribute]) ?? [];\r\n      group.push(row);\r\n      result.set(row[attribute],group);\r\n    }\r\n    return result;\r\n  }\r\n\r\n  function setCache() {\r\n    const records = base().getRecords();\r\n    cache = {\r\n      customers: new Map(records.customers.map(customer => [customer.id,customer])),\r\n      extracts: new Map(records.extracts.map(record => [record.id,record])),\r\n      items: mapRows(data.items,'order_id'),\r\n      shipments: mapRows(data.shipments,'order_item_id'),\r\n      feedback: mapRows(data.feedback,'order_id'),\r\n      services: mapRows(data.services,'order_id')\r\n    };\r\n  }\r\n\r\n  function metrics(order) {\r\n    const items = cache.items.get(order.id) ?? [];\r\n    const shipments = items.flatMap(item => cache.shipments.get(item.id) ?? []);\r\n    const sum = items.reduce((total,item) => total + lineAmount(item),0);\r\n    const total = sum - order.discount + order.shipping_fee;\r\n    const balance = Math.max(0,total - order.paid_amount);\r\n    const quantity = items.reduce((value,item) => value + item.quantity,0);\r\n    const shipped = shipments.reduce((value,item) => value + item.quantity,0);\r\n    return {\r\n      items,shipments,sum,total,balance,quantity,shipped,\r\n      payment:balance === 0 ? paymentStates[2] : order.paid_amount ? paymentStates[1] : paymentStates[0],\r\n      shipping:shipped >= quantity && quantity > 0 ? shippingStates[2] : shipped ? shippingStates[1] : shippingStates[0]\r\n    };\r\n  }\r\n\r\n  function lineAmount(item) {\r\n    return item.quantity * item.unit_price;\r\n  }\r\n\r\n  function byMetricTone(state) {\r\n    if (['\uC644\uB8CC','\uACB0\uC81C \uC644\uB8CC','\uCD9C\uACE0 \uC644\uB8CC'].includes(state)) return 'success';\r\n    if (['\uBBF8\uACB0\uC81C','\uBD80\uBD84 \uACB0\uC81C','\uCD9C\uACE0 \uB300\uAE30','\uBD80\uBD84 \uCD9C\uACE0','\uCC98\uB9AC \uC911'].includes(state)) return 'warning';\r\n    if (state === '\uCDE8\uC18C') return 'neutral';\r\n    return '';\r\n  }\r\n\r\n  function tag(value) {\r\n    const indicator = node('span',value,'erp-tag');\r\n    indicator.dataset.tone = byMetricTone(value);\r\n    return indicator;\r\n  }\r\n\r\n  function renderTotals(rows) {\r\n    const live = rows.filter(({order}) => order.status !== '\uCDE8\uC18C');\r\n    byId('erp-total-count').textContent = count(rows.length);\r\n    byId('erp-open-payment').textContent = money(live.reduce((total,row) => total + row.balance,0));\r\n    byId('erp-open-shipping').textContent = count(live.filter(row => row.shipped < row.quantity).length);\r\n    byId('erp-order-total').textContent = money(live.reduce((total,row) => total + row.total,0));\r\n  }\r\n\r\n  function renderScope() {\r\n    const target = byId('erp-scope');\r\n    target.hidden = !related;\r\n    target.replaceChildren();\r\n    if (!related) return;\r\n    const label = related.kind === 'customer' ? cache.customers.get(related.id)?.name : cache.extracts.get(related.id)?.title;\r\n    target.append(node('span',(related.kind === 'customer' ? '\uACE0\uAC1D ' : '\uCD94\uCD9C \uAE30\uB85D ') + (label || '\uC120\uD0DD\uB428')));\r\n    target.append(button('\uD544\uD130 \uD574\uC81C',() => { related = null; render(); }));\r\n  }\r\n\r\n  function orderText(order, row) {\r\n    const customer = cache.customers.get(order.customer_id);\r\n    const extracts = row.shipments.map(shipment => cache.extracts.get(shipment.extract_id)).filter(Boolean);\r\n    return [\r\n      order.order_no,order.customer_name,order.customer_phone,order.channel,order.note,order.address,\r\n      customer?.name,customer?.phone,customer?.phone?.replace(/\\D/g,''),\r\n      ...row.items.flatMap(item => [item.name,item.sku,item.note]),\r\n      ...extracts.flatMap(record => [record.title,record.source,JSON.stringify(Object.fromEntries(\r\n        Object.entries(record.data).filter(([key]) => key !== '__erp_png')))])\r\n    ].filter(Boolean).join(' ').toLocaleLowerCase('ko-KR');\r\n  }\r\n\r\n  function matchOrder(order, row, words) {\r\n    if (related?.kind === 'customer' && order.customer_id !== related.id) return false;\r\n    if (related?.kind === 'extract' && !row.shipments.some(shipment => shipment.extract_id === related.id)) return false;\r\n    if (dateFrom.value && order.ordered_on < dateFrom.value) return false;\r\n    if (dateTo.value && order.ordered_on > dateTo.value) return false;\r\n    if (statusFilter.value && order.status !== statusFilter.value) return false;\r\n    if (paymentFilter.value && row.payment !== paymentFilter.value) return false;\r\n    if (shippingFilter.value && row.shipping !== shippingFilter.value) return false;\r\n    if (!words.length) return true;\r\n    const haystack = orderText(order,row);\r\n    return words.every(word => haystack.includes(word));\r\n  }\r\n\r\n  function showEmptyDetail() {\r\n    detail.replaceChildren(node('h2','\uC8FC\uBB38 \uC0C1\uC138'),node('p','\uBAA9\uB85D\uC5D0\uC11C \uC8FC\uBB38\uC744 \uC120\uD0DD\uD558\uC138\uC694.','empty'));\r\n  }\r\n\r\n  function renderList(rows) {\r\n    list.replaceChildren();\r\n    const trimmed = search.value.trim().toLocaleLowerCase('ko-KR');\r\n    const words = trimmed ? trimmed.split(/\\s+/) : [];\r\n    const filtered = rows.filter(row => matchOrder(row.order,row,words));\r\n    byId('erp-match-count').textContent = count(filtered.length) + ' \uD45C\uC2DC';\r\n    if (!filtered.length) {\r\n      const message = ready ? (rows.length ? '\uC870\uAC74\uC5D0 \uB9DE\uB294 \uC8FC\uBB38\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.' : '\uB4F1\uB85D\uB41C \uC8FC\uBB38\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.') : '\uC8FC\uBB38\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4.';\r\n      list.append(node('p',message,'empty'));\r\n    }\r\n    for (const row of filtered) {\r\n      const {order} = row;\r\n      const block = node('div',undefined,'erp-order-row');\r\n      block.setAttribute('aria-current',String(selectedId === order.id));\r\n      const heading = node('div',undefined,'erp-order-row-head');\r\n      const title = order.order_no + ' \xB7 ' + customerName(order);\r\n      heading.append(button(title,() => { selectOrder(order.id); },'text-button'),node('strong',money(row.total)));\r\n      const itemLabel = row.items[0]?.name ?? '\uC0C1\uD488 \uC5C6\uC74C';\r\n      block.append(heading,node('p',order.ordered_on + ' \xB7 ' + itemLabel + (row.items.length > 1 ? ' \uC678 ' + (row.items.length - 1) + '\uC885' : ''),'muted'));\r\n      const tags = node('div',undefined,'erp-order-meta');\r\n      tags.append(tag(order.status),tag(row.payment),tag(row.shipping));\r\n      const remove = button('\uC0AD\uC81C',event => removeOrder(order,event.currentTarget),'erp-delete-order');\r\n      remove.setAttribute('aria-label',order.order_no + ' \uC0AD\uC81C');\r\n      tags.append(remove);\r\n      block.append(tags);\r\n      list.append(block);\r\n    }\r\n  }\r\n\r\n  function customerName(order) {\r\n    return order.customer_name || cache.customers.get(order.customer_id)?.name || '\uACE0\uAC1D';\r\n  }\r\n\r\n  async function removeOrder(order, control) {\r\n    if (deletingOrder || !window.confirm(order.order_no + ' \uC8FC\uBB38\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694?\\n\\n' +\r\n      '\uC8FC\uBB38 \uC0C1\uD488, \uCD9C\uACE0, \uB9CC\uC871\uB3C4, A/S \uB0B4\uC5ED\uB3C4 \uD568\uAED8 \uC0AD\uC81C\uB429\uB2C8\uB2E4. \uACE0\uAC1D \uC815\uBCF4\uC640 \uCD94\uCD9C \uAE30\uB85D\uC740 \uBCF4\uAD00\uB429\uB2C8\uB2E4.')) return;\r\n    deletingOrder = true;\r\n    control.disabled = true;\r\n    try {\r\n      await base().api('erp/remove',{kind:'orders',id:order.id,revision:order.revision});\r\n      if (selectedId === order.id) selectedId = null;\r\n      data.orders = data.orders.filter(entry => entry.id !== order.id);\r\n      render();\r\n      try {\r\n        await reload();\r\n        base().notice('\uC8FC\uBB38\uC744 \uC0AD\uC81C\uD588\uC2B5\uB2C8\uB2E4.');\r\n      } catch {\r\n        base().notice('\uC8FC\uBB38\uC744 \uC0AD\uC81C\uD588\uC2B5\uB2C8\uB2E4. \uCD5C\uC2E0 \uBAA9\uB85D\uC744 \uBCF4\uB824\uBA74 \uC8FC\uBB38 \uD0ED\uC744 \uB2E4\uC2DC \uC5F4\uC5B4 \uC8FC\uC138\uC694.',true);\r\n      }\r\n      search.focus();\r\n    } catch (error) {\r\n      base().notice(error.message,true);\r\n    } finally {\r\n      deletingOrder = false;\r\n      control.disabled = false;\r\n    }\r\n  }\r\n\r\n  function selectOrder(id, moveFocus = true) {\r\n    selectedId = id;\r\n    render();\r\n    if (moveFocus) {\r\n      detail.focus({preventScroll:true});\r\n      if (matchMedia('(max-width:760px)').matches) detail.scrollIntoView({block:'start'});\r\n    }\r\n  }\r\n\r\n  function addDefinition(target, name, value, isWide = false) {\r\n    const item = node('div',undefined,isWide ? 'erp-full' : '');\r\n    const content = node('dd');\r\n    if (value instanceof Node) content.append(value);\r\n    else content.textContent = String(value ?? '') || '\uBBF8\uC785\uB825';\r\n    item.append(node('dt',name),content);\r\n    target.append(item);\r\n  }\r\n\r\n  function renderProducts(target, row) {\r\n    const section = node('section',undefined,'divider');\r\n    section.append(node('h3','\uC8FC\uBB38 \uC0C1\uD488'));\r\n    const wrapper = node('div',undefined,'erp-table-wrap');\r\n    wrapper.tabIndex = 0;\r\n    wrapper.setAttribute('role','region');\r\n    wrapper.setAttribute('aria-label','\uC8FC\uBB38 \uC0C1\uD488 \uD45C');\r\n    const table = node('table');\r\n    table.setAttribute('aria-label','\uC8FC\uBB38 \uC0C1\uD488');\r\n    const header = table.createTHead().insertRow();\r\n    for (const [index,name] of ['\uC0C1\uD488\uBA85 \xB7 \uCF54\uB4DC','\uC218\uB7C9','\uB2E8\uAC00','\uAE08\uC561','\uCD9C\uACE0 \uC218\uB7C9'].entries()) {\r\n      const cell = node('th',name);\r\n      cell.scope = 'col';\r\n      if (index > 0) cell.dataset.number = '';\r\n      header.append(cell);\r\n    }\r\n    const body = table.createTBody();\r\n    for (const item of row.items) {\r\n      const line = body.insertRow();\r\n      const label = line.insertCell();\r\n      label.append(node('strong',item.name));\r\n      if (item.sku) label.append(node('p',item.sku,'muted'));\r\n      if (item.note) label.append(node('p',item.note,'muted erp-multiline'));\r\n      const shipped = (cache.shipments.get(item.id) ?? []).reduce((total,shipment) => total + shipment.quantity,0);\r\n      const values = [numberFormat.format(item.quantity),money(item.unit_price),money(lineAmount(item)),numberFormat.format(shipped)];\r\n      for (const value of values) {\r\n        const cell = line.insertCell();\r\n        cell.textContent = value;\r\n        cell.dataset.number = '';\r\n      }\r\n    }\r\n    wrapper.append(table);\r\n    section.append(wrapper);\r\n    target.append(section);\r\n  }\r\n\r\n  function renderDetail(row) {\r\n    const {order,items,shipments} = row;\r\n    detail.replaceChildren();\r\n    const header = node('div',undefined,'detail-head');\r\n    const title = node('div');\r\n    title.append(node('h2',order.order_no));\r\n    const states = node('div',undefined,'erp-order-meta');\r\n    states.append(tag(order.status),tag(row.payment),tag(row.shipping));\r\n    title.append(states);\r\n    header.append(title,button('\uC8FC\uBB38 \uC218\uC815',() => openEditor(order),'primary'));\r\n    detail.append(header);\r\n\r\n    const definitions = node('dl',undefined,'contact');\r\n    const customer = cache.customers.get(order.customer_id);\r\n    const label = customerName(order);\r\n    addDefinition(definitions,'\uACE0\uAC1D',customer ? button(label,() => base().openCustomer(order.customer_id),'text-button') : label);\r\n    addDefinition(definitions,'\uC8FC\uBB38\uC77C',order.ordered_on);\r\n    addDefinition(definitions,'\uC5F0\uB77D\uCC98',order.customer_phone ?? customer?.phone);\r\n    addDefinition(definitions,'\uC8FC\uBB38 \uCC44\uB110',order.channel);\r\n    addDefinition(definitions,'\uACB0\uC81C \uBC29\uC2DD',order.payment_method);\r\n    addDefinition(definitions,'\uBC30\uC1A1 \uC8FC\uC18C',order.address,true);\r\n    if (order.note) addDefinition(definitions,'\uC8FC\uBB38 \uBA54\uBAA8',order.note,true);\r\n    detail.append(definitions);\r\n\r\n    const payment = node('dl',undefined,'erp-amounts');\r\n    for (const [label,value] of [\r\n      ['\uC0C1\uD488 \uD569\uACC4',row.sum],['\uD560\uC778',order.discount],['\uBC30\uC1A1\uBE44',order.shipping_fee],['\uC8FC\uBB38 \uAE08\uC561',row.total],\r\n      ['\uC785\uAE08\uC561',order.paid_amount],['\uBBF8\uACB0\uC81C \uAE08\uC561',row.balance]\r\n    ]) addDefinition(payment,label,money(value));\r\n    if (order.paid_amount > row.total) addDefinition(payment,'\uCD08\uACFC \uC785\uAE08',money(order.paid_amount - row.total));\r\n    detail.append(payment);\r\n    renderProducts(detail,row);\r\n\r\n    const services = node('div');\r\n    detail.append(services);\r\n    window.erpService?.render(services,{\r\n      order,items,shipments,feedback:cache.feedback.get(order.id) ?? [],services:cache.services.get(order.id) ?? [],\r\n      extracts:[...cache.extracts.values()],reload\r\n    });\r\n  }\r\n\r\n  function render() {\r\n    setCache();\r\n    const rows = data.orders.map(order => ({order,...metrics(order)}));\r\n    renderTotals(rows);\r\n    renderScope();\r\n    renderList(rows);\r\n    const selected = rows.find(row => row.order.id === selectedId);\r\n    if (selected) renderDetail(selected);\r\n    else showEmptyDetail();\r\n  }\r\n\r\n  function resetFilters() {\r\n    for (const input of [search,dateFrom,dateTo,statusFilter,paymentFilter,shippingFilter]) input.value = '';\r\n    related = null;\r\n  }\r\n\r\n  async function reload() {\r\n    if (refreshing) return refreshing;\r\n    refreshing = (async () => {\r\n      data = await base().api('erp');\r\n      ready = true;\r\n      render();\r\n    })();\r\n    try { await refreshing; }\r\n    finally { refreshing = null; }\r\n  }\r\n\r\n  async function activate() {\r\n    render();\r\n    try { await reload(); }\r\n    catch (error) {\r\n      byId('erp-match-count').textContent = '\uC8FC\uBB38 \uC870\uD68C \uC2E4\uD328';\r\n      if (!ready) list.replaceChildren(node('p','\uC8FC\uBB38\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC8FC\uBB38 \uD0ED\uC744 \uB2E4\uC2DC \uC5F4\uC5B4 \uC8FC\uC138\uC694.','empty'));\r\n      base().notice(error.message,true);\r\n    }\r\n  }\r\n\r\n  function field(name, label, settings = {}) {\r\n    const wrapper = node('label',label,settings.wide ? 'erp-full' : '');\r\n    const field = node(settings.tag ?? 'input');\r\n    field.name = name;\r\n    if (settings.type) field.type = settings.type;\r\n    if (settings.required) field.required = true;\r\n    if (settings.maxLength !== undefined) field.maxLength = settings.maxLength;\r\n    if (settings.min !== undefined) field.min = settings.min;\r\n    if (settings.max !== undefined) field.max = settings.max;\r\n    if (settings.placeholder) field.placeholder = settings.placeholder;\r\n    if (settings.tag === 'textarea') field.rows = 2;\r\n    if (settings.choices) appendOptions(field,settings.choices,settings.prompt);\r\n    field.value = settings.value ?? '';\r\n    wrapper.append(field);\r\n    return [wrapper,field];\r\n  }\r\n\r\n  function addField(target,name,label,settings) {\r\n    const [wrapper,input] = field(name,label,settings);\r\n    target.append(wrapper);\r\n    return input;\r\n  }\r\n\r\n  function adjustLines() {\r\n    const rows = [...lines.children];\r\n    rows.forEach((el,index) => {\r\n      el.querySelector('legend').textContent = '\uC0C1\uD488 ' + (index + 1);\r\n      el.querySelector('button').disabled = rows.length <= 1 || el.dataset.locked === 'true';\r\n    });\r\n    byId('erp-add-line').disabled = rows.length >= 100;\r\n    showFormTotals();\r\n  }\r\n\r\n  function addLine(item = {}) {\r\n    const section = node('fieldset',undefined,'erp-line');\r\n    if (item.id) section.dataset.id = item.id;\r\n    const shipped = Boolean(cache.shipments.get(item.id)?.length);\r\n    const serviced = Boolean(item.id && (cache.services.get(editing?.id) ?? []).some(record => record.order_item_id === item.id));\r\n    section.dataset.locked = String(shipped || serviced);\r\n    section.append(node('legend','\uC0C1\uD488'));\r\n    const grid = node('div',undefined,'erp-fields');\r\n    const name = addField(grid,'name','\uC0C1\uD488\uBA85',{required:true,maxLength:200,value:item.name});\r\n    const sku = addField(grid,'sku','\uC0C1\uD488 \uCF54\uB4DC',{maxLength:100,value:item.sku});\r\n    name.readOnly = shipped;\r\n    sku.readOnly = shipped;\r\n    addField(grid,'quantity','\uC218\uB7C9',{type:'number',required:true,min:1,max:1000000,value:item.quantity ?? 1});\r\n    addField(grid,'unit_price','\uB2E8\uAC00 (\uC6D0)',{type:'number',required:true,min:0,max:1000000000000,value:item.unit_price ?? 0});\r\n    addField(grid,'note','\uC0C1\uD488 \uBA54\uBAA8',{tag:'textarea',wide:true,maxLength:1000,value:item.note});\r\n    const actions = node('div',undefined,'actions');\r\n    actions.append(button('\uC0C1\uD488 \uC0AD\uC81C',() => { section.remove(); adjustLines(); }));\r\n    section.append(grid,actions);\r\n    lines.append(section);\r\n    adjustLines();\r\n    return name;\r\n  }\r\n\r\n  function currentItems() {\r\n    return [...lines.children].map(line => {\r\n      const fields = Object.fromEntries([...line.querySelectorAll('input,textarea')].map(input => [input.name,input.value]));\r\n      return {\r\n        ...(line.dataset.id ? {id:line.dataset.id} : {}), ...fields,\r\n        quantity:Number(fields.quantity),unit_price:Number(fields.unit_price)\r\n      };\r\n    });\r\n  }\r\n\r\n  function showFormTotals() {\r\n    const meta = new FormData(form);\r\n    const sum = currentItems().reduce((total,item) => total + lineAmount(item),0);\r\n    const due = sum - Number(meta.get('discount')) + Number(meta.get('shipping_fee'));\r\n    byId('erp-form-totals').textContent = '\uC0C1\uD488 \uD569\uACC4 ' + money(sum) + ' \xB7 \uC8FC\uBB38 \uAE08\uC561 ' + money(due) +\r\n      ' \xB7 \uBBF8\uACB0\uC81C ' + money(Math.max(0,due - Number(meta.get('paid_amount'))));\r\n  }\r\n\r\n  function openEditor(order = null, customerId = null) {\r\n    const customers = [...base().getRecords().customers].sort((a,b) => a.name.localeCompare(b.name,'ko'));\r\n    if (!customers.length) {\r\n      base().notice('\uACE0\uAC1D \uD0ED\uC5D0\uC11C \uACE0\uAC1D\uC744 \uBA3C\uC800 \uB4F1\uB85D\uD574 \uC8FC\uC138\uC694.',true);\r\n      return false;\r\n    }\r\n    editing = order;\r\n    fields.replaceChildren();\r\n    lines.replaceChildren();\r\n    byId('erp-order-dialog-title').textContent = order ? '\uC8FC\uBB38 \uC218\uC815' : '\uC8FC\uBB38 \uB4F1\uB85D';\r\n    setError('');\r\n    const customer = addField(fields,'customer_id','\uACE0\uAC1D',{\r\n      tag:'select',required:true,prompt:'\uACE0\uAC1D \uC120\uD0DD',value:order?.customer_id ?? customerId,\r\n      choices:customers.map(item => [item.name + (item.phone ? ' \xB7 ' + item.phone : ''),item.id])\r\n    });\r\n    if (order) {\r\n      const hasHistory = metrics(order).shipments.length || cache.feedback.get(order.id)?.length || cache.services.get(order.id)?.length;\r\n      customer.disabled = Boolean(hasHistory);\r\n    }\r\n    addField(fields,'ordered_on','\uC8FC\uBB38\uC77C',{type:'date',required:true,value:order?.ordered_on ?? dateFormat.format(new Date())});\r\n    addField(fields,'status','\uC8FC\uBB38 \uC0C1\uD0DC',{tag:'select',choices:orderStates,value:order?.status ?? orderStates[0]});\r\n    addField(fields,'channel','\uC8FC\uBB38 \uCC44\uB110',{maxLength:100,placeholder:'\uC608: \uBC29\uBB38, \uC804\uD654, \uBA54\uC2E0\uC800',value:order?.channel});\r\n    const address = addField(fields,'address','\uBC30\uC1A1 \uC8FC\uC18C',{tag:'textarea',wide:true,maxLength:500,\r\n      value:order?.address ?? cache.customers?.get(customer.value)?.address});\r\n    customer.addEventListener('change',() => {\r\n      const record = customers.find(item => item.id === customer.value);\r\n      if (!address.value || !order) address.value = record?.address ?? '';\r\n    });\r\n    addField(fields,'payment_method','\uACB0\uC81C \uBC29\uC2DD',{maxLength:80,placeholder:'\uC608: \uCE74\uB4DC, \uACC4\uC88C\uC774\uCCB4',value:order?.payment_method});\r\n    for (const [name,label] of [['paid_amount','\uC785\uAE08\uC561 (\uC6D0)'],['discount','\uD560\uC778 (\uC6D0)'],['shipping_fee','\uBC30\uC1A1\uBE44 (\uC6D0)']]) {\r\n      addField(fields,name,label,{type:'number',required:true,min:0,max:1000000000000,value:order?.[name] ?? 0});\r\n    }\r\n    addField(fields,'note','\uC8FC\uBB38 \uBA54\uBAA8',{tag:'textarea',wide:true,maxLength:1000,value:order?.note});\r\n    for (const item of order ? cache.items.get(order.id) ?? [{}] : [{}]) addLine(item);\r\n    showFormTotals();\r\n    dialog.showModal();\r\n    (customer.disabled ? fields.querySelector('[name=ordered_on]') : customer).focus();\r\n    return true;\r\n  }\r\n\r\n  function setError(text) {\r\n    const el = form.querySelector('.form-error');\r\n    el.textContent = text;\r\n    el.hidden = !text;\r\n  }\r\n\r\n  form.addEventListener('submit',async event => {\r\n    event.preventDefault();\r\n    if (waiting) return;\r\n    const values = Object.fromEntries([...fields.querySelectorAll('input,textarea,select')].map(input => [input.name,input.value]));\r\n    const {customer_id,ordered_on,status,channel,address,note,discount,shipping_fee,paid_amount,payment_method} = values;\r\n    const body = {\r\n      customer_id,ordered_on,status,channel,address,note,payment_method,\r\n      discount:Number(discount),shipping_fee:Number(shipping_fee),paid_amount:Number(paid_amount),items:currentItems(),\r\n      ...(editing ? {id:editing.id,revision:editing.revision} : {})\r\n    };\r\n    const sum = body.items.reduce((total,item) => total + lineAmount(item),0);\r\n    if (!Number.isSafeInteger(sum + body.shipping_fee)) {\r\n      setError('\uC8FC\uBB38 \uAE08\uC561\uC774 \uB108\uBB34 \uD07D\uB2C8\uB2E4. \uC218\uB7C9\uACFC \uB2E8\uAC00\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694.');\r\n      return;\r\n    }\r\n    if (body.discount > sum + body.shipping_fee) {\r\n      setError('\uD560\uC778\uC740 \uC0C1\uD488 \uAE08\uC561\uC5D0 \uBC30\uC1A1\uBE44\uB97C \uB354\uD55C \uAE08\uC561 \uC774\uD558\uB85C \uC785\uB825\uD558\uC138\uC694.');\r\n      return;\r\n    }\r\n    setError('');\r\n    waiting = true;\r\n    submit.disabled = true;\r\n    try {\r\n      const result = await base().api('erp/orders',body);\r\n      dialog.close();\r\n      selectedId = result.id;\r\n      resetFilters();\r\n      try { await reload(); }\r\n      catch (error) {\r\n        base().notice('\uC8FC\uBB38\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4. \uBAA9\uB85D\uC744 \uB2E4\uC2DC \uC5F4\uC5B4 \uC8FC\uC138\uC694.',true);\r\n        return;\r\n      }\r\n      selectOrder(result.id);\r\n      base().notice('\uC8FC\uBB38\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.');\r\n    } catch (error) { setError(error.message); }\r\n    finally { waiting = false; submit.disabled = false; }\r\n  });\r\n\r\n  search.addEventListener('input',render);\r\n  for (const input of [dateFrom,dateTo,statusFilter,paymentFilter,shippingFilter]) input.addEventListener('change',render);\r\n  byId('erp-reset').addEventListener('click',() => { resetFilters(); render(); });\r\n  byId('erp-add-order').addEventListener('click',() => openEditor());\r\n  byId('erp-add-line').addEventListener('click',() => addLine().focus());\r\n  byId('erp-close-order').addEventListener('click',() => { if (!waiting) dialog.close(); });\r\n  dialog.addEventListener('cancel',event => { if (waiting) event.preventDefault(); });\r\n  form.addEventListener('input',showFormTotals);\r\n\r\n  window.erpUi = {\r\n    activate,\r\n    reload,\r\n    refreshCustomerLabels:render,\r\n    async openOrder(id) {\r\n      if (!ready || !data.orders.some(order => order.id === id)) await activate();\r\n      resetFilters();\r\n      selectOrder(id);\r\n    },\r\n    openNewOrder(customerId) { setCache(); return openEditor(null,customerId); },\r\n    async openRelated(kind,id) {\r\n      if (!ready) await activate();\r\n      resetFilters();\r\n      related = {kind,id};\r\n      selectedId = null;\r\n      render();\r\n    }\r\n  };\r\n})();\r\n", "text/javascript"], "/orders/erp.css": [".erp-overview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.85rem;margin:0 0 1rem}\r\n.erp-overview div{padding:.9rem 1rem;background:#fff;border:1px solid var(--line);border-radius:12px}\r\n.erp-overview dd{margin-top:.3rem;font-size:clamp(1.05rem,2.4vw,1.5rem);font-weight:750;font-variant-numeric:tabular-nums}\r\n.erp-workspace{display:grid;grid-template-columns:minmax(285px,355px) minmax(0,1fr);gap:1rem;align-items:start}\r\n.erp-list-controls{display:grid;gap:.8rem;padding:1rem;border-bottom:1px solid var(--line)}\r\n.erp-list-controls p{min-height:1.4em}\r\n.erp-filters summary{display:inline-block;padding:.35rem .55rem;font-size:.9rem}\r\n.erp-filters .erp-fields{padding-top:.6rem}\r\n.erp-filter-actions{align-self:end;justify-self:start}\r\n.erp-scope{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;color:#264f80;background:var(--soft);border-radius:8px;padding:.4rem .55rem;font-size:.9rem}\r\n.erp-scope button{font-size:.85rem;padding:.2rem .4rem}\r\n.erp-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem}\r\n.erp-full{grid-column:1/-1}\r\n.erp-order-row{display:grid;gap:.35rem;padding:.8rem 1rem;border-bottom:1px solid var(--line)}\r\n.erp-order-row:last-child{border-bottom:0;border-radius:0 0 14px 14px}\r\n.erp-order-row[aria-current=true]{background:var(--soft);box-shadow:inset 3px 0 var(--brand)}\r\n.erp-order-row-head{display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start}\r\n.erp-order-row-head button{min-width:0}\r\n.erp-order-row-head strong{white-space:nowrap;font-variant-numeric:tabular-nums}\r\n.erp-order-meta{display:flex;gap:.4rem;flex-wrap:wrap;align-items:center}\r\n.erp-tag{display:inline-block;padding:.2rem .45rem;border-radius:6px;background:#eef3f8;color:#304b66;font-size:.82rem;line-height:1.45;font-weight:650;white-space:nowrap}\r\n.erp-tag[data-tone=success]{background:#e0f2e8;color:#215c43}\r\n.erp-tag[data-tone=warning]{background:#fff0ce;color:#704b08}\r\n.erp-tag[data-tone=neutral]{background:#f2eded;color:#64484e}\r\n.erp-list-panel .empty{padding:1rem}\r\n.erp-detail{min-width:0}\r\n.erp-detail .contact{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:1rem}\r\n.erp-detail .contact div{grid-template-columns:minmax(4.8rem,auto) 1fr}\r\n.erp-detail .contact dt,.erp-detail .contact dd{min-width:0}\r\n.erp-detail dl .erp-full{grid-column:1/-1}\r\n.erp-detail h2{font-size:1.3rem}\r\n.erp-amounts{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:.65rem;margin:.9rem 0;padding:.75rem;border-radius:8px;background:#f5f8fc}\r\n.erp-amounts dd{margin-top:.22rem;font-weight:700;font-variant-numeric:tabular-nums}\r\n.erp-table-wrap{overflow:auto}\r\n.erp-detail table{min-width:28rem;table-layout:auto}\r\n.erp-detail th{width:auto}\r\n.erp-detail td[data-number],.erp-detail th[data-number]{text-align:right;white-space:nowrap}\r\n.erp-form-section{display:grid;gap:.6rem;border-top:1px solid var(--line);padding-top:.9rem}\r\n.erp-dialog{width:min(780px,calc(100% - 2rem))}\r\n.erp-line{border:1px solid var(--line);padding:.75rem;border-radius:8px;margin:0 0 .65rem;min-inline-size:0}\r\n.erp-line legend{font-weight:650;padding-inline:.3rem}\r\n.erp-line .actions{margin-top:.55rem}\r\n.erp-form-totals{font-weight:650;background:#f1f5fc;border-radius:8px;padding:.65rem .75rem}\r\n.erp-multiline{white-space:pre-wrap}\r\n@media(max-width:760px){.erp-overview{grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem}.erp-overview div{padding:.7rem}.erp-workspace{grid-template-columns:minmax(0,1fr)}.erp-detail{min-height:150px}}\r\n@media(max-width:440px){.erp-detail .contact{grid-template-columns:1fr}.erp-order-row-head{flex-wrap:wrap}.erp-fields label{font-size:.875rem}}\r\n.erp-delete-order{margin-inline-start:auto;padding:.25rem .55rem;color:#98272b;border-color:#e2b8ba;font-size:.85rem}\r\n.erp-delete-order:hover:not(:disabled){background:#fff1f1}\r\n", "text/css"], "/orders/erp-service.js": ["(() => {\r\n  'use strict';\r\n\r\n  const number = new Intl.NumberFormat('ko-KR');\r\n  const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'});\r\n  const serviceStatuses = ['\uC811\uC218','\uC9C4\uD589 \uC911','\uC644\uB8CC','\uCDE8\uC18C'];\r\n  const serviceStyles = {'\uC811\uC218':'open','\uC9C4\uD589 \uC911':'in_progress','\uC644\uB8CC':'resolved','\uCDE8\uC18C':'cancelled'};\r\n  let pending = false;\r\n\r\n  function element(tag, text, className) {\r\n    const node = document.createElement(tag);\r\n    if (text !== undefined) node.textContent = text;\r\n    if (className) node.className = className;\r\n    return node;\r\n  }\r\n\r\n  function button(text, onClick, className) {\r\n    const node = element('button',text,className);\r\n    node.type = 'button';\r\n    node.addEventListener('click',onClick);\r\n    return node;\r\n  }\r\n\r\n  function openSection(parent, name, action, onClick, actionId) {\r\n    const section = element('section',undefined,'erp-service-section');\r\n    const heading = element('div',undefined,'erp-service-heading');\r\n    const title = element('h3',name);\r\n    title.id = actionId + '-heading';\r\n    section.setAttribute('aria-labelledby',title.id);\r\n    const trigger = button(action,onClick);\r\n    trigger.id = actionId;\r\n    heading.append(title,trigger);\r\n    section.append(heading);\r\n    parent.append(section);\r\n    return {section, trigger};\r\n  }\r\n\r\n  function adjacentEntries(parent, records, emptyText, renderEntry) {\r\n    if (!records.length) {\r\n      parent.append(element('p',emptyText,'erp-service-empty'));\r\n      return;\r\n    }\r\n    const list = element('ul',undefined,'erp-service-list');\r\n    for (const record of records) {\r\n      const entry = element('li',undefined,'erp-service-entry');\r\n      const contents = element('div',undefined,'erp-service-entry-body');\r\n      entry.append(contents);\r\n      renderEntry(entry,contents,record);\r\n      list.append(entry);\r\n    }\r\n    parent.append(list);\r\n  }\r\n\r\n  function description(parent, content) {\r\n    if (content) parent.append(element('p',content,'erp-service-entry-note'));\r\n  }\r\n\r\n  function actionsFor(entry, label, edit, remove) {\r\n    const actions = element('div',undefined,'actions erp-service-actions');\r\n    const editButton = button('\uC218\uC815',edit);\r\n    const removeButton = button('\uC0AD\uC81C',remove);\r\n    editButton.setAttribute('aria-label',label + ' \uC218\uC815');\r\n    removeButton.setAttribute('aria-label',label + ' \uC0AD\uC81C');\r\n    actions.append(editButton,removeButton);\r\n    entry.append(actions);\r\n  }\r\n\r\n  function itemLabel(item) {\r\n    return item?.name ? item.name + (item.sku ? ' \xB7 ' + item.sku : '') : '\uC0C1\uD488';\r\n  }\r\n\r\n  function titleRow(parent, title) {\r\n    const row = element('div',undefined,'erp-service-entry-title');\r\n    row.append(element('h4',title));\r\n    parent.append(row);\r\n    return row;\r\n  }\r\n\r\n  function itemRemaining(context, item, editing) {\r\n    const shipped = context.shipments.reduce((total,record) => (\r\n      record.order_item_id === item.id && record.id !== editing?.id ? total + record.quantity : total\r\n    ), 0);\r\n    return Math.max(0,item.quantity - shipped);\r\n  }\r\n\r\n  function openDialog({title, controlId, fields, onSubmit, onInit, reload, success}) {\r\n    if (pending) return;\r\n    const dialog = element('dialog',undefined,'erp-service-dialog');\r\n    const heading = element('h2',title);\r\n    heading.id = 'erp-service-dialog-title';\r\n    dialog.setAttribute('aria-labelledby',heading.id);\r\n    const form = element('form');\r\n    const group = element('div',undefined,'erp-service-fields');\r\n    const controls = {};\r\n    for (const field of fields) {\r\n      const label = element('label',undefined,field.full ? 'erp-service-full' : undefined);\r\n      const labelText = element('span',field.label);\r\n      labelText.id = 'erp-service-label-' + field.name;\r\n      const control = element(field.type === 'select' || field.type === 'textarea' ? field.type : 'input');\r\n      if (control.tagName === 'SELECT') {\r\n        for (const [value,text] of field.options) control.add(new Option(text,value));\r\n      } else if (control.tagName === 'TEXTAREA') {\r\n        control.rows = field.rows ?? 3;\r\n      } else {\r\n        control.type = field.type;\r\n      }\r\n      if (field.maxLength !== undefined) control.maxLength = field.maxLength;\r\n      for (const key of ['min','max','step','required']) {\r\n        if (field[key] !== undefined) control[key] = field[key];\r\n      }\r\n      control.name = field.name;\r\n      control.setAttribute('aria-labelledby',labelText.id);\r\n      control.value = field.value ?? '';\r\n      label.append(labelText,control);\r\n      if (field.help) {\r\n        const help = element('small',field.help,'erp-service-help');\r\n        help.id = 'erp-service-help-' + field.name;\r\n        control.setAttribute('aria-describedby',help.id);\r\n        label.append(help);\r\n      }\r\n      controls[field.name] = control;\r\n      group.append(label);\r\n    }\r\n    const error = element('p',undefined,'form-error');\r\n    error.setAttribute('role','alert');\r\n    error.hidden = true;\r\n    const actions = element('div',undefined,'actions');\r\n    const cancel = button('\uB2EB\uAE30',() => dialog.close());\r\n    const submit = element('button','\uC800\uC7A5','primary');\r\n    submit.type = 'submit';\r\n    actions.append(cancel,submit);\r\n    form.append(heading,group,error,actions);\r\n    dialog.append(form);\r\n    dialog.addEventListener('close',() => dialog.remove(),{once:true});\r\n    dialog.addEventListener('cancel',event => {\r\n      if (pending) event.preventDefault();\r\n    });\r\n    form.addEventListener('submit',async event => {\r\n      event.preventDefault();\r\n      if (pending) return;\r\n      pending = true;\r\n      submit.disabled = true;\r\n      cancel.disabled = true;\r\n      error.hidden = true;\r\n      try {\r\n        await onSubmit(Object.fromEntries(new FormData(form)));\r\n      } catch (problem) {\r\n        error.textContent = problem.message;\r\n        error.hidden = false;\r\n        pending = false;\r\n        submit.disabled = false;\r\n        cancel.disabled = false;\r\n        return;\r\n      }\r\n      dialog.close();\r\n      try {\r\n        await reload();\r\n        window.erpData.notice(success);\r\n        document.getElementById(controlId)?.focus();\r\n      } catch {\r\n        window.erpData.notice('\uC800\uC7A5\uC740 \uC644\uB8CC\uB410\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD558\uC5EC \uCD5C\uC2E0 \uB0B4\uC5ED\uC744 \uD655\uC778\uD558\uC138\uC694.',true);\r\n      } finally {\r\n        pending = false;\r\n      }\r\n    });\r\n    controls[fields[0].name].autofocus = true;\r\n    onInit?.(controls);\r\n    document.body.append(dialog);\r\n    dialog.showModal();\r\n  }\r\n\r\n  const memoField = value => ({name:'note',label:'\uBA54\uBAA8',type:'textarea',maxLength:1000,full:true,value});\r\n  const dateField = (name, label, value) => ({name,label,type:'date',required:true,value:value ?? date.format(new Date())});\r\n  const orderItemOptions = items => items.map(item => [item.id,itemLabel(item)]);\r\n\r\n  async function remove(context, kind, record, label, controlId) {\r\n    if (pending || !window.confirm(label + ' \uAE30\uB85D\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694?')) return;\r\n    pending = true;\r\n    try {\r\n      await window.erpData.api('erp/remove',{kind,id:record.id});\r\n      try {\r\n        await context.reload();\r\n        window.erpData.notice(label + ' \uAE30\uB85D\uC744 \uC0AD\uC81C\uD588\uC2B5\uB2C8\uB2E4.');\r\n        document.getElementById(controlId)?.focus();\r\n      } catch {\r\n        window.erpData.notice('\uC0AD\uC81C\uB294 \uC644\uB8CC\uB410\uC2B5\uB2C8\uB2E4. \uC0C8\uB85C\uACE0\uCE68\uD558\uC5EC \uCD5C\uC2E0 \uB0B4\uC5ED\uC744 \uD655\uC778\uD558\uC138\uC694.',true);\r\n      }\r\n    } catch (error) {\r\n      window.erpData.notice(error.message,true);\r\n    } finally {\r\n      pending = false;\r\n    }\r\n  }\r\n\r\n  let loadingShipment = false;\r\n  async function shipmentDialog(context, shipment) {\r\n    const availableItems = context.items.filter(item => itemRemaining(context,item,shipment) > 0);\r\n    if (!availableItems.length || loadingShipment || pending) return;\r\n    loadingShipment = true;\r\n    try {\r\n      await window.erpData.refresh();\r\n    } catch (error) {\r\n      window.erpData.notice(error.message,true);\r\n      return;\r\n    } finally {\r\n      loadingShipment = false;\r\n    }\r\n    const extracts = window.erpData.getRecords().extracts;\r\n    const itemId = shipment?.order_item_id ?? availableItems[0].id;\r\n    const options = availableItems.map(item => [item.id,itemLabel(item) + ' \xB7 \uCD9C\uACE0 \uAC00\uB2A5 ' +\r\n      number.format(itemRemaining(context,item,shipment)) + '\uAC1C']);\r\n    const fields = [\r\n      {name:'order_item_id',label:'\uC8FC\uBB38 \uC0C1\uD488',type:'select',options,required:true,value:itemId,full:true},\r\n      {name:'extract_id',label:'\uCD94\uCD9C \uAE30\uB85D',type:'select',full:true,value:shipment?.extract_id,\r\n        options:[['','\uC5F0\uACB0 \uC5C6\uC774 \uAE30\uB85D'],...extracts.map(extract => [extract.id,extract.title])],\r\n        help:'\uC2E4\uC81C\uB85C \uCD9C\uACE0\uD55C \uC0C1\uD488\uC5D0 \uD574\uB2F9\uD558\uB294 \uCD94\uCD9C \uAE30\uB85D\uC744 \uC120\uD0DD\uD558\uC138\uC694.'},\r\n      {name:'quantity',label:'\uCD9C\uACE0 \uC218\uB7C9',type:'number',required:true,min:1,step:1,value:shipment?.quantity},\r\n      dateField('shipped_on','\uCD9C\uACE0 \uB0A0\uC9DC',shipment?.shipped_on),\r\n      memoField(shipment?.note)\r\n    ];\r\n    openDialog({\r\n      title:shipment ? '\uCD9C\uACE0 \uAE30\uB85D \uC218\uC815' : '\uCD9C\uACE0 \uAE30\uB85D \uCD94\uAC00',\r\n      controlId:'erp-add-shipment',\r\n      fields,\r\n      onInit(controls) {\r\n        const update = () => {\r\n          const item = availableItems.find(row => row.id === controls.order_item_id.value);\r\n          controls.quantity.max = Math.min(1000000,itemRemaining(context,item,shipment));\r\n        };\r\n        controls.order_item_id.addEventListener('change',update);\r\n        update();\r\n      },\r\n      onSubmit:async values => {\r\n        const extract_id = await window.erpData.registerExtract(values.extract_id);\r\n        return window.erpData.api('erp/shipments',{\r\n          ...values,id:shipment?.id,extract_id,quantity:Number(values.quantity)\r\n        });\r\n      },\r\n      reload:context.reload,\r\n      success:'\uCD9C\uACE0 \uAE30\uB85D\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.'\r\n    });\r\n  }\r\n\r\n  function renderShipments(parent, context) {\r\n    const {section,trigger} = openSection(parent,'\uCD9C\uACE0 \uBC0F \uCD94\uCD9C \uAE30\uB85D','\uCD9C\uACE0 \uCD94\uAC00',\r\n      () => shipmentDialog(context),'erp-add-shipment');\r\n    trigger.disabled = !context.items.some(item => itemRemaining(context,item) > 0);\r\n    if (trigger.disabled && context.items.length) section.append(element('p','\uBAA8\uB4E0 \uC8FC\uBB38 \uC0C1\uD488\uC758 \uCD9C\uACE0\uB97C \uAE30\uB85D\uD588\uC2B5\uB2C8\uB2E4.','erp-service-empty'));\r\n    adjacentEntries(section,context.shipments,'\uAE30\uB85D\uB41C \uCD9C\uACE0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.',(entry,contents,record) => {\r\n      const item = context.items.find(row => row.id === record.order_item_id);\r\n      titleRow(contents,itemLabel(item) + ' \xB7 ' + number.format(record.quantity) + '\uAC1C');\r\n      contents.append(element('p',record.shipped_on,'erp-service-entry-meta'));\r\n      const extract = context.extracts.find(row => row.id === record.extract_id);\r\n      if (extract) {\r\n        const ref = element('p',undefined,'erp-service-entry-note');\r\n        ref.append(element('strong','\uCD94\uCD9C \uAE30\uB85D'),button(extract.title,() => window.erpData.openExtract(extract.id),'text-button'));\r\n        contents.append(ref);\r\n      } else {\r\n        description(contents,'\uCD9C\uACE0\uC5D0 \uC5F0\uACB0\uB41C \uCD94\uCD9C \uAE30\uB85D \uC5C6\uC74C');\r\n      }\r\n      description(contents,record.note);\r\n      actionsFor(entry,'\uCD9C\uACE0 \uAE30\uB85D',() => shipmentDialog(context,record),\r\n        () => remove(context,'shipments',record,'\uCD9C\uACE0','erp-add-shipment'));\r\n    });\r\n  }\r\n\r\n  function feedbackDialog(context, feedback) {\r\n    const fields = [\r\n      {name:'score',label:'\uB9CC\uC871\uB3C4 \uC810\uC218',type:'select',required:true,\r\n        options:[['','\uC810\uC218 \uC120\uD0DD'],...['1','2','3','4','5'].map(score => [score,score + '\uC810'])],value:feedback?.score},\r\n      dateField('recorded_on','\uAE30\uB85D \uB0A0\uC9DC',feedback?.recorded_on),\r\n      {...memoField(feedback?.note),label:'\uACE0\uAC1D \uC758\uACAC'}\r\n    ];\r\n    openDialog({\r\n      title:feedback ? '\uB9CC\uC871\uB3C4 \uC218\uC815' : '\uB9CC\uC871\uB3C4 \uCD94\uAC00',\r\n      controlId:'erp-add-feedback',\r\n      fields,\r\n      onSubmit:values => window.erpData.api('erp/feedback',{\r\n        ...values,id:feedback?.id,order_id:context.order.id,score:Number(values.score)\r\n      }),\r\n      reload:context.reload,\r\n      success:'\uB9CC\uC871\uB3C4 \uAE30\uB85D\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.'\r\n    });\r\n  }\r\n\r\n  function renderFeedback(parent, context) {\r\n    const {section} = openSection(parent,'\uB9CC\uC871\uB3C4','\uB9CC\uC871\uB3C4 \uCD94\uAC00',\r\n      () => feedbackDialog(context),'erp-add-feedback');\r\n    adjacentEntries(section,context.feedback,'\uAE30\uB85D\uB41C \uB9CC\uC871\uB3C4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.',(entry,contents,record) => {\r\n      titleRow(contents,record.score + '\uC810 / 5\uC810');\r\n      contents.append(element('p',record.recorded_on,'erp-service-entry-meta'));\r\n      description(contents,record.note);\r\n      actionsFor(entry,'\uB9CC\uC871\uB3C4 ' + record.recorded_on,() => feedbackDialog(context,record),\r\n        () => remove(context,'feedback',record,'\uB9CC\uC871\uB3C4','erp-add-feedback'));\r\n    });\r\n  }\r\n\r\n  function serviceDialog(context, service) {\r\n    const fields = [\r\n      {name:'subject',label:'\uBB38\uC758\xB7A/S \uC81C\uBAA9',type:'text',required:true,maxLength:160,full:true,value:service?.subject},\r\n      {name:'order_item_id',label:'\uAD00\uB828 \uC8FC\uBB38 \uC0C1\uD488',type:'select',full:true,value:service?.order_item_id,\r\n        options:[['','\uC8FC\uBB38 \uC804\uCCB4'],...orderItemOptions(context.items)]},\r\n      {name:'status',label:'\uCC98\uB9AC \uC0C1\uD0DC',type:'select',required:true,\r\n        options:serviceStatuses.map(status => [status,status]),value:service?.status ?? '\uC811\uC218'},\r\n      dateField('opened_on','\uC811\uC218 \uB0A0\uC9DC',service?.opened_on),\r\n      {...memoField(service?.note),label:'\uBB38\uC758 \uB0B4\uC6A9 \uBC0F \uCC98\uB9AC \uBA54\uBAA8',rows:4}\r\n    ];\r\n    openDialog({\r\n      title:service ? 'A/S \uAE30\uB85D \uC218\uC815' : 'A/S \uAE30\uB85D \uCD94\uAC00',\r\n      controlId:'erp-add-service',\r\n      fields,\r\n      onSubmit:values => window.erpData.api('erp/services',{\r\n        ...values,id:service?.id,order_id:context.order.id,order_item_id:values.order_item_id || null\r\n      }),\r\n      reload:context.reload,\r\n      success:'A/S \uAE30\uB85D\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.'\r\n    });\r\n  }\r\n\r\n  function renderServices(parent, context) {\r\n    const {section} = openSection(parent,'A/S','A/S \uCD94\uAC00',() => serviceDialog(context),'erp-add-service');\r\n    adjacentEntries(section,context.services,'\uC811\uC218\uB41C A/S\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.',(entry,contents,record) => {\r\n      const heading = titleRow(contents,record.subject);\r\n      const status = element('span',record.status,'erp-service-tag');\r\n      status.dataset.state = serviceStyles[record.status] ?? '';\r\n      heading.append(status);\r\n      const item = context.items.find(row => row.id === record.order_item_id);\r\n      contents.append(element('p',record.opened_on + ' \xB7 ' + (item ? itemLabel(item) : '\uC8FC\uBB38 \uC804\uCCB4'),'erp-service-entry-meta'));\r\n      description(contents,record.note);\r\n      actionsFor(entry,'A/S ' + record.subject,() => serviceDialog(context,record),\r\n        () => remove(context,'services',record,'A/S','erp-add-service'));\r\n    });\r\n  }\r\n\r\n  window.erpService = {\r\n    render(container,context) {\r\n      const root = element('div',undefined,'erp-service');\r\n      renderShipments(root,context);\r\n      renderFeedback(root,context);\r\n      renderServices(root,context);\r\n      container.append(root);\r\n    }\r\n  };\r\n})();\r\n", "text/javascript"], "/orders/erp-service.css": ['.erp-service { display:grid; gap:1.2rem; margin-top:1.35rem; }\r\n.erp-service-section { min-width:0; border-top:1px solid var(--line); padding-top:1rem; }\r\n.erp-service-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:.55rem; }\r\n.erp-service-heading h3 { font-size:1.05rem; }\r\n.erp-service-heading button { font-size:.9rem; }\r\n.erp-service-list { list-style:none; margin:.6rem 0 0; padding:0; }\r\n.erp-service-entry { display:flex; justify-content:space-between; align-items:flex-start; gap:.8rem; padding:.75rem 0; border-bottom:1px solid var(--line); }\r\n.erp-service-entry:last-child { border-bottom:0; padding-bottom:0; }\r\n.erp-service-entry-body { min-width:0; flex:1; }\r\n.erp-service-entry-title { display:flex; gap:.4rem .65rem; align-items:center; flex-wrap:wrap; font-weight:700; overflow-wrap:anywhere; }\r\n.erp-service-entry-title h4 { font-size:1rem; margin:0; }\r\n.erp-service-entry-title button { white-space:normal; }\r\n.erp-service-entry-meta { color:var(--muted); margin-top:.2rem; font-size:.88rem; }\r\n.erp-service-entry-note { min-width:0; margin-top:.25rem; white-space:pre-wrap; }\r\n.erp-service-entry-note strong { margin-right:.35rem; }\r\n.erp-service-actions { flex:0 0 auto; }\r\n.erp-service-actions button { font-size:.88rem; }\r\n.erp-service-tag { padding:.15rem .5rem; border:1px solid #cbdaf0; border-radius:999px; color:#224774; background:#edf4fb; font-size:.82rem; font-weight:650; white-space:nowrap; }\r\n.erp-service-tag[data-state="resolved"] { color:#205b42; background:#ebf6ef; border-color:#bfdecc; }\r\n.erp-service-tag[data-state="in_progress"] { color:#75460e; background:#fff5df; border-color:#ecd6a8; }\r\n.erp-service-empty { color:var(--muted); padding:.65rem 0 0; }\r\n.erp-service-dialog form { gap:.8rem; }\r\n.erp-service-dialog .erp-service-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.75rem; }\r\n.erp-service-dialog .erp-service-full { grid-column:1/-1; }\r\n.erp-service-dialog .erp-service-help { font-size:.89rem; color:var(--muted); font-weight:400; }\r\n.erp-service-dialog .form-error { line-height:1.5; }\r\n@media(max-width:460px) {\r\n  .erp-service-dialog .erp-service-fields { grid-template-columns:minmax(0,1fr); }\r\n  .erp-service-entry { flex-wrap:wrap; }\r\n}\r\n', "text/css"] };

// history.mjs
var MAX_PNG = 16 * 1024 * 1024;
var PNG_PART_SIZE = 512 * 1024;
var pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
var filenamePattern = /^(\d{4}-\d{2}-\d{2})_(\d+)\.png$/;
var namespaceURL = Uint8Array.from([107, 167, 184, 17, 157, 173, 17, 209, 128, 180, 0, 192, 79, 212, 48, 200]);
var json2 = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
function encodeImagePart(bytes) {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(text);
}
async function orderExtractId(filename) {
  const name = new TextEncoder().encode("shot-history/" + filename);
  const bytes = new Uint8Array(namespaceURL.length + name.length);
  bytes.set(namespaceURL);
  bytes.set(name, namespaceURL.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes)).slice(0, 16);
  hash[6] = hash[6] & 15 | 80;
  hash[8] = hash[8] & 63 | 128;
  const hex = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
async function findShot(db, owner, filename) {
  const match = typeof filename === "string" && filenamePattern.exec(filename);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  return db.prepare("SELECT id, title, notes FROM shot_history WHERE owner_id=? AND day=? AND number=?").bind(owner, match[1], Number(match[2])).first();
}
function shotFilename(day, number) {
  return day + "_" + String(number).padStart(3, "0") + ".png";
}
async function saveShot(request, db, owner, day) {
  const date = Date.parse(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== day || request.headers.get("Content-Type") !== "image/png" || Number(request.headers.get("Content-Length")) > MAX_PNG) {
    return json2({ error: "\uCD94\uCD9C \uB0A0\uC9DC\uC640 PNG \uD30C\uC77C\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694." }, 400);
  }
  const started = request.headers.get("X-Shot-Started-At");
  const timestamp2 = started === null ? Date.now() : Date.parse(started);
  let notes;
  try {
    const raw = request.headers.get("X-Shot-Notes");
    notes = raw === null ? null : decodeURIComponent(raw);
    if (!Number.isFinite(timestamp2) || (notes?.length ?? 0) > 1e3) throw new Error();
  } catch {
    return json2({ error: "\uCD94\uCD9C \uC2DC\uAC04\uC774\uB098 \uBA54\uBAA8\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694." }, 400);
  }
  const image = new Uint8Array(await request.arrayBuffer());
  if (image.length > MAX_PNG || !pngSignature.every((byte, index) => image[index] === byte)) {
    return json2({ error: "16MB \uC774\uD558\uC758 PNG \uC774\uBBF8\uC9C0\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4." }, 400);
  }
  const id2 = crypto.randomUUID();
  const statements = [db.prepare(
    "INSERT INTO shot_history(owner_id,id,day,number,started_at,notes) SELECT ?,?,?,COALESCE(MAX(number),0)+1,?,? FROM shot_history WHERE owner_id=? AND day=?"
  ).bind(owner, id2, day, timestamp2 / 1e3, notes, owner, day)];
  for (let offset = 0; offset < image.length; offset += PNG_PART_SIZE) {
    const bytes = image.subarray(offset, offset + PNG_PART_SIZE);
    statements.push(db.prepare("INSERT INTO shot_image_parts VALUES (?,?,?,?)").bind(owner, id2, offset / PNG_PART_SIZE, encodeImagePart(bytes)));
  }
  await db.batch(statements);
  const saved = await db.prepare("SELECT number FROM shot_history WHERE owner_id=? AND id=?").bind(owner, id2).first();
  return json2({ path: shotFilename(day, saved.number), number: saved.number }, 201);
}
async function historyApi(request, db, owner, url) {
  const { pathname: path } = url;
  if (request.method === "POST" && (request.headers.get("Origin") !== url.origin || request.headers.get("X-Shot-Save") !== "1")) {
    return json2({ error: "\uC694\uCCAD \uCD9C\uCC98\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 403);
  }
  if (path === "/api/extractions") {
    if (request.method === "POST") return saveShot(request, db, owner, url.searchParams.get("date") ?? "");
    if (request.method === "GET") {
      const { results } = await db.prepare(
        "SELECT day, number, started_at, title FROM shot_history WHERE owner_id=? ORDER BY day DESC, started_at DESC, number DESC"
      ).bind(owner).all();
      return json2({ records: await Promise.all(results.map(async (row2) => {
        const filename2 = shotFilename(row2.day, row2.number);
        return {
          filename: filename2,
          date: row2.day,
          number: row2.number,
          timestamp: row2.started_at,
          title: row2.title,
          url: "/api/extractions/files/" + filename2,
          orderExtractId: await orderExtractId(filename2)
        };
      })) });
    }
  }
  const route = /^\/api\/extractions\/(files|title|notes)\/([^/]+)$/.exec(path);
  if (!route) return json2({ error: "\uC694\uCCAD\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 404);
  const [, field, filename] = route;
  const shot = await findShot(db, owner, filename);
  if (!shot) return json2({ error: "\uCD94\uCD9C \uAE30\uB85D\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 404);
  if (field === "files" && request.method === "GET") {
    const { results } = await db.prepare(
      "SELECT data FROM shot_image_parts WHERE owner_id=? AND shot_id=? ORDER BY position"
    ).bind(owner, shot.id).all();
    const stream = new ReadableStream({
      start(controller) {
        for (const { data } of results) controller.enqueue(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)));
        controller.close();
      }
    });
    return new Response(stream, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  if (field !== "files" && request.method === "GET") return json2({ [field]: shot[field] });
  if (field !== "files" && request.method === "POST") {
    let value;
    try {
      const raw = await request.text();
      if (raw.length > 8192) throw new Error();
      value = JSON.parse(raw);
      if (typeof value !== "string" || value.length > (field === "title" ? 120 : 1e3)) throw new Error();
      if (field === "title") {
        value = value.trim() || null;
        if (value && /[\r\n]/.test(value)) throw new Error();
      }
    } catch {
      return json2({ error: "\uC81C\uBAA9 \uB610\uB294 \uBA54\uBAA8\uC758 \uD615\uC2DD\uACFC \uAE38\uC774\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694." }, 400);
    }
    await db.prepare("UPDATE shot_history SET " + field + "=? WHERE owner_id=? AND id=?").bind(value, owner, shot.id).run();
    return json2({ [field]: value });
  }
  return json2({ error: "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uC694\uCCAD\uC785\uB2C8\uB2E4." }, 405);
}

// worker.mjs
var json3 = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
var pagePolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'self'; base-uri 'none'; form-action 'none'";
var worker_default2 = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "GET" && Object.hasOwn(assets, path)) {
      const [body, type] = assets[path];
      return new Response(body, { headers: {
        "Content-Type": type + "; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": pagePolicy,
        "X-Content-Type-Options": "nosniff"
      } });
    }
    if (path === "/orders") return Response.redirect(new URL("/orders/", url), 302);
    if (path === "/api/window/open" || path === "/api/window/close") return json3({ ok: true });
    if (path !== "/api/extractions" && !path.startsWith("/api/extractions/") && !path.startsWith("/orders/api/")) {
      return json3({ error: "\uC694\uCCAD\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 404);
    }
    const owner = request.headers.get("oai-authenticated-user-id");
    if (!owner) return json3({ error: "\uB85C\uADF8\uC778 \uD6C4 \uC774\uC6A9\uD558\uC138\uC694." }, 401);
    if (!env.DB) return json3({ error: "\uB370\uC774\uD130 \uC800\uC7A5\uC18C\uC5D0 \uC5F0\uACB0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 503);
    try {
      if (path.startsWith("/orders/api/")) {
        const backend = new URL(url);
        backend.pathname = path.slice("/orders".length);
        if (path === "/orders/api/shot-extract" && request.method === "POST") {
          if (request.headers.get("Origin") !== url.origin) return json3({ error: "\uC694\uCCAD \uCD9C\uCC98\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 403);
          let filename;
          try {
            ({ filename } = await request.json());
          } catch {
            return json3({ error: "\uCD94\uCD9C \uD30C\uC77C \uC774\uB984\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694." }, 400);
          }
          if (!await findShot(env.DB, owner, filename)) return json3({ error: "\uCD94\uCD9C \uAE30\uB85D\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, 404);
          return worker_default.fetch(new Request(backend, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: url.origin, "oai-authenticated-user-id": owner },
            body: JSON.stringify({ filename, id: await orderExtractId(filename) })
          }), env);
        }
        return worker_default.fetch(new Request(backend, request), env);
      }
      return await historyApi(request, env.DB, owner, url);
    } catch (error) {
      console.error("Sites data request failed:", error.name);
      return json3({ error: "\uC11C\uBC84 \uC791\uC5C5\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694." }, 500);
    }
  }
};
export {
  worker_default2 as default
};
