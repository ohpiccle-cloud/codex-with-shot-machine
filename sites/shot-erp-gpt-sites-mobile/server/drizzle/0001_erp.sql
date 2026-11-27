CREATE TABLE erp_orders (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  order_no TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  ordered_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('접수', '처리 중', '완료', '취소')),
  channel TEXT NOT NULL,
  address TEXT NOT NULL,
  note TEXT NOT NULL,
  discount INTEGER NOT NULL CHECK (discount >= 0),
  shipping_fee INTEGER NOT NULL CHECK (shipping_fee >= 0),
  paid_amount INTEGER NOT NULL CHECK (paid_amount >= 0),
  payment_method TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  write_token TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, order_no),
  FOREIGN KEY (owner_id, customer_id) REFERENCES customers(owner_id, id)
);
--> statement-breakpoint
CREATE TABLE erp_order_items (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  note TEXT NOT NULL,
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, order_id, id),
  FOREIGN KEY (owner_id, order_id) REFERENCES erp_orders(owner_id, id)
);
--> statement-breakpoint
CREATE TABLE erp_shipments (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  extract_id TEXT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  shipped_on TEXT NOT NULL,
  note TEXT NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, order_item_id) REFERENCES erp_order_items(owner_id, id),
  FOREIGN KEY (owner_id, extract_id) REFERENCES extracts(owner_id, id)
);
--> statement-breakpoint
CREATE TABLE erp_feedback (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  recorded_on TEXT NOT NULL,
  note TEXT NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, order_id) REFERENCES erp_orders(owner_id, id)
);
--> statement-breakpoint
CREATE TABLE erp_services (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_item_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('접수', '진행 중', '완료', '취소')),
  opened_on TEXT NOT NULL,
  subject TEXT NOT NULL,
  note TEXT NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, order_id) REFERENCES erp_orders(owner_id, id),
  FOREIGN KEY (owner_id, order_id, order_item_id) REFERENCES erp_order_items(owner_id, order_id, id)
);
--> statement-breakpoint
CREATE INDEX erp_orders_ordered_on ON erp_orders(owner_id, ordered_on);
--> statement-breakpoint
CREATE INDEX erp_orders_customer ON erp_orders(owner_id, customer_id, ordered_on);
--> statement-breakpoint
CREATE INDEX erp_items_order ON erp_order_items(owner_id, order_id, position);
--> statement-breakpoint
CREATE INDEX erp_shipments_item ON erp_shipments(owner_id, order_item_id, shipped_on);
--> statement-breakpoint
CREATE INDEX erp_shipments_extract ON erp_shipments(owner_id, extract_id);
--> statement-breakpoint
CREATE INDEX erp_feedback_order ON erp_feedback(owner_id, order_id, recorded_on);
--> statement-breakpoint
CREATE INDEX erp_services_order ON erp_services(owner_id, order_id, opened_on);
--> statement-breakpoint
CREATE INDEX erp_services_item ON erp_services(owner_id, order_item_id);
--> statement-breakpoint
CREATE TRIGGER erp_shipment_limit_insert BEFORE INSERT ON erp_shipments
WHEN NOT EXISTS (
  SELECT 1 FROM erp_shipments WHERE owner_id = NEW.owner_id AND id = NEW.id
) AND NEW.quantity + COALESCE((
  SELECT SUM(quantity) FROM erp_shipments
  WHERE owner_id = NEW.owner_id AND order_item_id = NEW.order_item_id
), 0) > (
  SELECT quantity FROM erp_order_items WHERE owner_id = NEW.owner_id AND id = NEW.order_item_id
)
BEGIN
  SELECT RAISE(ABORT, 'ERP_SHIPMENT_LIMIT');
END;
--> statement-breakpoint
CREATE TRIGGER erp_shipment_limit_update BEFORE UPDATE OF quantity, order_item_id ON erp_shipments
WHEN NEW.quantity + COALESCE((
  SELECT SUM(quantity) FROM erp_shipments
  WHERE owner_id = NEW.owner_id AND order_item_id = NEW.order_item_id AND id <> NEW.id
), 0) > (
  SELECT quantity FROM erp_order_items WHERE owner_id = NEW.owner_id AND id = NEW.order_item_id
)
BEGIN
  SELECT RAISE(ABORT, 'ERP_SHIPMENT_LIMIT');
END;
--> statement-breakpoint
CREATE TRIGGER erp_order_item_quantity_update BEFORE UPDATE OF quantity ON erp_order_items
WHEN NEW.quantity < COALESCE((
  SELECT SUM(quantity) FROM erp_shipments WHERE owner_id = OLD.owner_id AND order_item_id = OLD.id
), 0)
BEGIN
  SELECT RAISE(ABORT, 'ERP_ORDER_QUANTITY_LIMIT');
END;
--> statement-breakpoint
CREATE TRIGGER erp_order_item_keep_history BEFORE DELETE ON erp_order_items
WHEN EXISTS (
  SELECT 1 FROM erp_shipments WHERE owner_id = OLD.owner_id AND order_item_id = OLD.id
) OR EXISTS (
  SELECT 1 FROM erp_services WHERE owner_id = OLD.owner_id AND order_item_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'ERP_ITEM_HAS_HISTORY');
END;
--> statement-breakpoint
CREATE TRIGGER erp_order_item_keep_product BEFORE UPDATE OF name, sku ON erp_order_items
WHEN (NEW.name <> OLD.name OR NEW.sku <> OLD.sku) AND EXISTS (
  SELECT 1 FROM erp_shipments WHERE owner_id = OLD.owner_id AND order_item_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'ERP_ITEM_PRODUCT_LOCKED');
END;
--> statement-breakpoint
CREATE TRIGGER erp_order_keep_customer BEFORE UPDATE OF customer_id ON erp_orders
WHEN NEW.customer_id <> OLD.customer_id AND (
  EXISTS (
    SELECT 1 FROM erp_shipments AS shipment
    JOIN erp_order_items AS item ON item.owner_id = shipment.owner_id AND item.id = shipment.order_item_id
    WHERE item.owner_id = OLD.owner_id AND item.order_id = OLD.id
  ) OR EXISTS (
    SELECT 1 FROM erp_feedback WHERE owner_id = OLD.owner_id AND order_id = OLD.id
  ) OR EXISTS (
    SELECT 1 FROM erp_services WHERE owner_id = OLD.owner_id AND order_id = OLD.id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'ERP_ORDER_CUSTOMER_LOCKED');
END;
