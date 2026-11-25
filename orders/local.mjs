import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker/index.mjs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new DatabaseSync(process.argv[2]);
db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');

function transaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

transaction(() => {
  db.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  for (const name of ['0000_customer_extracts', '0001_erp']) {
    if (db.prepare('SELECT name FROM local_migrations WHERE name=?').get(name)) continue;
    db.exec(readFileSync(new URL('./drizzle/' + name + '.sql', import.meta.url), 'utf8'));
    db.prepare('INSERT INTO local_migrations VALUES (?)').run(name);
  }
});

class Statement {
  constructor(sql, args = []) {
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new Statement(this.sql, args);
  }

  run() {
    const statement = db.prepare(this.sql);
    if (statement.columns().length) return { results: statement.all(...this.args), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(statement.run(...this.args).changes) } };
  }
}

try {
  const request = new Request(input.url, {
    method: input.method,
    headers: { ...input.headers, 'oai-authenticated-user-id': 'local' },
    body: input.body,
  });
  const response = await worker.fetch(request, {
    DB: {
      prepare: sql => new Statement(sql),
      batch: statements => transaction(() => statements.map(statement => statement.run())),
    },
  });
  process.stdout.write(JSON.stringify({ status: response.status, body: await response.json() }));
} finally {
  db.close();
}
