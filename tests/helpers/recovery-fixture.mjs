import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';
const moduleUrl = async (file) =>
  'data:text/javascript;base64,' +
  Buffer.from(
    ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText,
  ).toString('base64');
const { backupTables } = await import(
  await moduleUrl('../../lib/team-backup.ts')
);
const migrations = await Promise.all(
  (await readdir(new URL('../../drizzle/', import.meta.url)))
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((n) =>
      readFile(new URL('../../drizzle/' + n, import.meta.url), 'utf8'),
    ),
);
export function destination() {
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
        async first() {
          return statement.get(...values) ?? null;
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
        const results = [];
        for (const statement of statements)
          results.push({ results: await statement.run() });
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sql, database };
}
export function fixture() {
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
export const rowCounts = (sql) =>
  Object.fromEntries(
    [...backupTables.map(([name]) => name), 'workspace_owners'].map((name) => [
      name,
      sql.prepare('SELECT COUNT(*) n FROM ' + name).get().n,
    ]),
  );
