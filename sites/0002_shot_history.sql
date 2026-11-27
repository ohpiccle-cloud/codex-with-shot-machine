CREATE TABLE shot_history (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  day TEXT NOT NULL,
  number INTEGER NOT NULL,
  started_at REAL NOT NULL,
  notes TEXT,
  title TEXT,
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, day, number)
);
--> statement-breakpoint
CREATE TABLE shot_image_parts (
  owner_id TEXT NOT NULL,
  shot_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (owner_id, shot_id, position),
  FOREIGN KEY (owner_id, shot_id) REFERENCES shot_history(owner_id, id)
);
