import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = async (file, replacements = []) => {
  let source = await readFile(new URL(file, import.meta.url), 'utf8');
  for (const [from, to] of replacements) source = source.replace(from, to);
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
const backupUrl = await moduleUrl('../lib/team-backup.ts');
const { backupTables } = await import(backupUrl);
const { planRecovery } = await import(
  await moduleUrl('../lib/recovery-plan.ts', [
    ["'@/lib/team-backup'", JSON.stringify(backupUrl)],
  ])
);
const migrations = await Promise.all(
  (await readdir(new URL('../drizzle/', import.meta.url)))
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((n) => readFile(new URL('../drizzle/' + n, import.meta.url), 'utf8')),
);
function destination() {
  const sql = new DatabaseSync(':memory:');
  for (const migration of migrations) sql.exec(migration);
  sql.exec('PRAGMA foreign_keys=ON');
  const database = {
    prepare(query) {
      const statement = sql.prepare(query);
      let values = [];
      return {
        bind(...v) {
          values = v;
          return this;
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async run() {
          return statement.all(...values);
        },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        for (const statement of statements) await statement.run();
        sql.exec('COMMIT');
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sql, database };
}
function fixture() {
  const { sql } = destination();
  sql
    .prepare(
      'INSERT INTO teams(id,name,short_name,season,created_at) VALUES(?,?,?,?,?)',
    )
    .run(
      'recovery-team',
      'Recovery test',
      'Recovery',
      '2026',
      '2026-11-08T12:00:00.000Z',
    );
  sql
    .prepare(
      `INSERT INTO athletes(id,team_id,first_name,last_name,position,unit,graduation_year,height,weight_lb,email,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      'recovery-athlete',
      'recovery-team',
      'Private',
      'Athlete',
      'DB',
      'Defence',
      12,
      '6 ft',
      180,
      'fixture@example.test',
      'now',
      'now',
    );
  sql
    .prepare('INSERT INTO depth_charts(id,team_id,name,unit) VALUES(?,?,?,?)')
    .run('recovery-depth', 'recovery-team', 'Alignment', 'Defence');
  sql
    .prepare(
      'INSERT INTO depth_assignments(id,depth_chart_id,athlete_id,position,rank,x,y) VALUES(?,?,?,?,?,?,?)',
    )
    .run(
      'recovery-assignment',
      'recovery-depth',
      'recovery-athlete',
      'DB',
      1,
      25,
      40,
    );
  sql
    .prepare(
      'INSERT INTO workspace_state(id,team_id,state_key,value_json,updated_at) VALUES(?,?,?,?,?)',
    )
    .run(
      'recovery-state',
      'recovery-team',
      'fixture',
      JSON.stringify({ privateNote: 'Restored only to the chosen owner' }),
      'now',
    );
  const tables = Object.fromEntries(
    backupTables.map(([name]) => [
      name,
      sql
        .prepare('SELECT * FROM ' + name)
        .all()
        .map((row) => ({ ...row })),
    ]),
  );
  sql.close();
  return {
    format: 'chalktalk-team-backup',
    version: 1,
    id: 'recovery-backup',
    createdAt: '2026-11-08T12:00:00.000Z',
    teamId: 'recovery-team',
    tables,
    media: [],
    parts: 1,
    mediaBytes: 0,
  };
}
const rowCounts = (sql) =>
  Object.fromEntries(
    [...backupTables.map(([name]) => name), 'workspace_owners'].map((name) => [
      name,
      sql.prepare('SELECT COUNT(*) n FROM ' + name).get().n,
    ]),
  );
test('recovery restores every exact schema table, related rows and only a newly chosen ownership grant', async () => {
  const { sql, database } = destination(),
    snapshot = fixture();
  try {
    const plan = await planRecovery(database, snapshot, 'trusted-new-owner');
    assert.equal(plan.records, 5);
    assert.equal(plan.mediaBytes, 0);
    await database.batch(plan.statements);
    for (const [name] of backupTables)
      assert.deepEqual(
        sql
          .prepare('SELECT * FROM ' + name)
          .all()
          .map((row) => ({ ...row })),
        snapshot.tables[name],
      );
    assert.deepEqual(
      sql
        .prepare('SELECT user_id,team_id FROM workspace_owners')
        .all()
        .map((row) => ({ ...row })),
      [{ user_id: 'trusted-new-owner', team_id: 'recovery-team' }],
    );
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
    const before = rowCounts(sql);
    await assert.rejects(
      database.batch(
        (await planRecovery(database, snapshot, 'another-owner')).statements,
      ),
    );
    assert.deepEqual(rowCounts(sql), before);
  } finally {
    sql.close();
  }
});
test('late destination creation and incomplete relationships roll back rather than merging or leaving partial rows', async () => {
  for (const kind of ['late-team', 'missing-parent']) {
    const { sql, database } = destination(),
      snapshot = fixture();
    try {
      if (kind === 'missing-parent') snapshot.tables.athletes = [];
      const plan = await planRecovery(database, snapshot, 'trusted-owner');
      if (kind === 'late-team')
        sql
          .prepare(
            'INSERT INTO teams(id,name,short_name,season,created_at) VALUES(?,?,?,?,?)',
          )
          .run('existing', 'Existing', 'Existing', '2026', 'now');
      const before = rowCounts(sql);
      await assert.rejects(database.batch(plan.statements));
      assert.deepEqual(rowCounts(sql), before);
      assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      sql.close();
    }
  }
});
test('recovery refuses injected ownership, cross-team rows, altered schemas and unreadable saved state before writing', async () => {
  const cases = [
    (snapshot) => (snapshot.tables.workspace_owners = []),
    (snapshot) => delete snapshot.tables.film_clips,
    (snapshot) => (snapshot.tables.athletes[0].team_id = 'foreign-team'),
    (snapshot) => (snapshot.tables.athletes[0].surprise = 'column'),
    (snapshot) => delete snapshot.tables.athletes[0].email,
    (snapshot) => (snapshot.tables.workspace_state[0].value_json = '{broken'),
    (snapshot) =>
      snapshot.tables.teams.push({
        ...snapshot.tables.teams[0],
        id: 'second-team',
      }),
    (snapshot) => (snapshot.teamId = '../unsafe'),
    (snapshot) => (snapshot.mediaBytes = 1),
    (snapshot) => (snapshot.tables.athletes[0].height = {}),
  ];
  for (const change of cases) {
    const { sql, database } = destination(),
      snapshot = fixture();
    try {
      change(snapshot);
      await assert.rejects(planRecovery(database, snapshot, 'trusted-owner'));
      assert.ok(Object.values(rowCounts(sql)).every((count) => count === 0));
    } finally {
      sql.close();
    }
  }
});
test('recovery rejects unsafe files, duplicate keys and inconsistent totals without constructing write statements', async () => {
  const file = {
    key: 'film-one',
    size: 3,
    etag: 'version',
    sha256: 'a'.repeat(64),
    part: 1,
    contentType: 'video/mp4',
    originalName: 'Film.mp4',
    httpMetadata: { contentType: 'video/mp4' },
    customMetadata: {},
  };
  const valid = destination(),
    validSnapshot = fixture();
  validSnapshot.media = [structuredClone(file)];
  validSnapshot.mediaBytes = 3;
  try {
    assert.equal(
      (await planRecovery(valid.database, validSnapshot, 'trusted-owner'))
        .mediaBytes,
      3,
    );
  } finally {
    valid.sql.close();
  }
  for (const change of [
    (snapshot) => snapshot.media.push({ ...file, key: '../outside' }),
    (snapshot) => snapshot.media.push({ ...file }),
    (snapshot) => (snapshot.media[0].size = -1),
    (snapshot) => (snapshot.media[0].sha256 = 'invalid'),
    (snapshot) => (snapshot.media[0].part = 2),
    (snapshot) => (snapshot.media[0].contentType = 'video/mp4\r\nBad: header'),
    (snapshot) => (snapshot.media[0].key = '_backups/hidden'),
    (snapshot) => (snapshot.mediaBytes = 4),
  ]) {
    const { sql, database } = destination(),
      snapshot = fixture();
    snapshot.media = [structuredClone(file)];
    snapshot.mediaBytes = 3;
    try {
      change(snapshot);
      await assert.rejects(planRecovery(database, snapshot, 'trusted-owner'));
      assert.ok(Object.values(rowCounts(sql)).every((count) => count === 0));
    } finally {
      sql.close();
    }
  }
});
