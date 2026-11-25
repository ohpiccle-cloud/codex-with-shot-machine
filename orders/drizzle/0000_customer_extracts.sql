CREATE TABLE customers (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, id)
);
--> statement-breakpoint
CREATE TABLE extracts (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, id)
);
--> statement-breakpoint
CREATE TABLE customer_extracts (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  extract_id TEXT NOT NULL,
  quantity INTEGER CHECK (quantity BETWEEN 1 AND 1000000),
  linked_on TEXT NOT NULL,
  note TEXT NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, customer_id) REFERENCES customers(owner_id, id),
  FOREIGN KEY (owner_id, extract_id) REFERENCES extracts(owner_id, id)
);
--> statement-breakpoint
CREATE INDEX customer_extracts_customer ON customer_extracts(owner_id, customer_id, linked_on);
--> statement-breakpoint
CREATE INDEX customer_extracts_extract ON customer_extracts(owner_id, extract_id);
