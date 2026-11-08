import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
const url = async (file, replacements = []) => {
  let source = await readFile(new URL(file, import.meta.url), 'utf8');
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
  return (
    'data:text/javascript;base64,' +
    Buffer.from(
      ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    ).toString('base64')
  );
};
const { prepareCreation } = await import(
  await url('../lib/playbook-creation.ts')
);
const validator = await url('../lib/validate-play.ts');
const { parsePlaybookLibrary } = await import(
  await url('../lib/playbook-library.ts', [
    ["'@/lib/validate-play'", JSON.stringify(validator)],
  ])
);

test('concurrent creation claims are atomic, owner-scoped and retryable after rollback', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(
    `CREATE TABLE workspace_state(id TEXT PRIMARY KEY,team_id TEXT,state_key TEXT,value_json TEXT,updated_at TEXT,UNIQUE(team_id,state_key)); CREATE TABLE playbooks(id TEXT PRIMARY KEY,team_id TEXT);`,
  );
  const db = (teamId) => ({
    teamId,
    prepare(query) {
      const statement = sql.prepare(query);
      let values = [];
      return {
        bind(...v) {
          values = v;
          return this;
        },
        async first() {
          return statement.get(...values) ?? null;
        },
        run() {
          return statement.run(...values);
        },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const results = statements.map((s) => s.run());
        sql.exec('COMMIT');
        return results;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  });
  const a = db('a'),
    b = db('b'),
    body = { kind: 'book', name: 'Defence', creationId: crypto.randomUUID() };
  const [one, two] = await Promise.all([
    prepareCreation(a, body),
    prepareCreation(a, body),
  ]);
  const insert = (db, id) =>
    db.prepare('INSERT INTO playbooks VALUES (?,?)').bind(id, db.teamId);
  const ids = await Promise.all([
    one.commit([insert(a, one.id)]),
    two.commit([insert(a, two.id)]),
  ]);
  assert.equal(ids[0], ids[1]);
  assert.equal(sql.prepare('SELECT count(*) n FROM playbooks').get().n, 1);
  const other = await prepareCreation(b, body);
  await other.commit([insert(b, other.id)]);
  assert.notEqual(other.id, ids[0]);
  assert.equal((await prepareCreation(a, body)).id, ids[0]);
  await assert.rejects(
    () => prepareCreation(a, { ...body, name: 'Changed' }),
    (e) => e.status === 409,
  );
  const failedBody = { ...body, creationId: crypto.randomUUID() },
    failed = await prepareCreation(a, failedBody);
  await assert.rejects(() => failed.commit([insert(a, ids[0])]));
  assert.equal(
    sql
      .prepare('SELECT count(*) n FROM workspace_state WHERE state_key = ?')
      .get('pb-create-' + failedBody.creationId).n,
    0,
  );
  const retry = await prepareCreation(a, failedBody);
  await retry.commit([insert(a, retry.id)]);
  sql.close();
});

test('library parsing distinguishes blank data from incomplete, duplicate or unconfirmed responses', () => {
  const empty = { books: [], plays: [], formations: [] };
  assert.deepEqual(parsePlaybookLibrary(empty), empty);
  assert.throws(() => parsePlaybookLibrary({ books: [], plays: [] }));
  assert.throws(() => parsePlaybookLibrary({ ...empty, createdId: 'missing' }));
  const book = {
    id: 'b',
    name: 'Defence',
    side: 'Defence',
    archived: false,
    plays: 0,
    formations: 0,
    updated: 'today',
  };
  assert.equal(
    parsePlaybookLibrary({ ...empty, books: [book], createdId: 'b' }).createdId,
    'b',
  );
  assert.throws(() => parsePlaybookLibrary({ ...empty, books: [book, book] }));
  assert.throws(() =>
    parsePlaybookLibrary({ ...empty, books: [{ ...book, archived: 0 }] }),
  );
});
