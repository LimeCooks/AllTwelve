import { DatabaseSync } from 'node:sqlite';
import { createReadStream } from 'node:fs';
import {
  access,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Local preparation only. This command has no network, deployment, database
// mutation or owner-grant export path. The cloud destination must independently
// validate this manifest, verify uploaded SHA-256s, and refuse existing data.
export async function prepareCloudRecovery({ directory, output }) {
  const root = await realpath(path.resolve(directory));
  const target = path.resolve(output ?? path.join(root, 'cloud-recovery.json'));
  try {
    await access(target);
    throw new Error(
      'The recovery manifest already exists. Choose a new output file; nothing was overwritten.',
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await access(path.join(root, 'RESTORE_INCOMPLETE.txt'));
    throw new Error(
      'The offline recovery is incomplete. Restore every backup part into a new folder first.',
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const metadata = JSON.parse(
    await readFile(path.join(root, 'recovery.json'), 'utf8'),
  );
  if (
    metadata.complete !== true ||
    !metadata.backupId ||
    !metadata.teamId ||
    !metadata.ownerId ||
    typeof metadata.backupCreatedAt !== 'string' ||
    !Number.isFinite(Date.parse(metadata.backupCreatedAt)) ||
    !Array.isArray(metadata.media) ||
    !metadata.mediaSha256 ||
    !Number.isInteger(metadata.parts) ||
    metadata.parts < 1 ||
    metadata.parts > 10000
  )
    throw new Error(
      'Use a complete recovery made with the current offline recovery tool.',
    );
  const expected = new DatabaseSync(':memory:');
  let database;
  try {
    for (const name of (await readdir(new URL('../drizzle/', import.meta.url)))
      .filter((name) => name.endsWith('.sql'))
      .sort())
      expected.exec(
        await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8'),
      );
    database = new DatabaseSync(path.join(root, 'workspace.sqlite'), {
      readOnly: true,
    });
    const tableNames = (db) =>
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => row.name);
    const names = tableNames(expected);
    if (JSON.stringify(names) !== JSON.stringify(tableNames(database)))
      throw new Error(
        'The recovered database does not match the current schema.',
      );
    if (
      database
        .prepare('PRAGMA integrity_check')
        .all()
        .some((row) => row.integrity_check !== 'ok') ||
      database.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new Error(
        'The recovered database failed integrity or relationship checks.',
      );
    const columns = (db, table) =>
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name);
    const tables = {};
    for (const name of names) {
      if (
        JSON.stringify(columns(database, name)) !==
        JSON.stringify(columns(expected, name))
      )
        throw new Error(
          'The recovered columns do not match the current schema.',
        );
      if (name === 'workspace_owners') continue;
      if (['team_invitations', 'team_memberships'].includes(name)) {
        if (database.prepare(`SELECT 1 FROM ${name} LIMIT 1`).get())
          throw new Error(
            'Recovery preparation must not carry existing invitations or memberships. Restore the portable backup into a new directory first.',
          );
        continue;
      }
      tables[name] = database
        .prepare(`SELECT * FROM ${name}`)
        .all()
        .map((row) => ({ ...row }));
      for (const row of tables[name]) {
        if ('team_id' in row && row.team_id !== metadata.teamId)
          throw new Error('A recovered record belongs to another team.');
        for (const [column, value] of Object.entries(row))
          if (column.endsWith('_json') && value !== null) {
            if (typeof value !== 'string')
              throw new Error('A recovered JSON record is invalid.');
            JSON.parse(value);
          }
      }
    }
    const owners = database
      .prepare('SELECT user_id, team_id FROM workspace_owners')
      .all();
    if (
      tables.teams.length !== 1 ||
      tables.teams[0].id !== metadata.teamId ||
      owners.length !== 1 ||
      owners[0].user_id !== metadata.ownerId ||
      owners[0].team_id !== metadata.teamId
    )
      throw new Error(
        'The offline recovery must contain exactly its recorded team and owner.',
      );
    const media = [],
      seen = new Set();
    let mediaBytes = 0;
    for (const file of metadata.media) {
      if (
        !file ||
        typeof file.key !== 'string' ||
        !/^[a-z0-9][a-z0-9._/-]{0,159}$/i.test(file.key) ||
        file.key
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        seen.has(file.key) ||
        !/^[a-f0-9]{64}$/.test(metadata.mediaSha256[file.key] ?? '')
      )
        throw new Error(
          'The recovered file manifest is invalid or lacks original checksums.',
        );
      const mediaRoot = await realpath(path.join(root, 'media'));
      const filename = await realpath(path.join(mediaRoot, file.key));
      if (!filename.startsWith(mediaRoot + path.sep))
        throw new Error('A recovered file points outside the media folder.');
      const info = await stat(filename);
      if (!info.isFile() || info.size !== file.size)
        throw new Error('A recovered file has changed or is missing.');
      const digest = createHash('sha256');
      let readBytes = 0;
      for await (const chunk of createReadStream(filename)) {
        digest.update(chunk);
        readBytes += chunk.length;
      }
      const sha256 = digest.digest('hex');
      if (readBytes !== file.size || sha256 !== metadata.mediaSha256[file.key])
        throw new Error(
          'A recovered file no longer matches its verified backup bytes.',
        );
      media.push({ ...file, sha256 });
      mediaBytes += file.size;
      seen.add(file.key);
    }
    if (
      media.length !== metadata.mediaFiles ||
      mediaBytes !== metadata.mediaBytes ||
      Object.keys(metadata.mediaSha256).length !== media.length
    )
      throw new Error('The recovered file totals are inconsistent.');
    const manifest = {
      format: 'alltwelve-team-backup',
      version: 1,
      id: metadata.backupId,
      createdAt: metadata.backupCreatedAt,
      teamId: metadata.teamId,
      tables,
      media,
      mediaBytes,
      parts: metadata.parts,
    };
    const serialized = JSON.stringify(manifest);
    if (Buffer.byteLength(serialized) > 18 * 1024 * 1024)
      throw new Error(
        'The recovery manifest exceeds the supported structured size.',
      );
    await writeFile(target, serialized, { flag: 'wx' });
    return {
      manifest: target,
      records: Object.values(tables).reduce(
        (total, rows) => total + rows.length,
        0,
      ),
      mediaFiles: media.length,
      mediaBytes,
    };
  } finally {
    database?.close();
    expected.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const directory = process.argv[2];
  if (!directory || process.argv.length > 3) {
    console.error(
      'Usage: node scripts/prepare-cloud-recovery.mjs COMPLETE_OFFLINE_RECOVERY_FOLDER',
    );
    process.exitCode = 1;
  } else
    try {
      console.log(JSON.stringify(await prepareCloudRecovery({ directory })));
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : 'Recovery preparation failed.',
      );
      process.exitCode = 1;
    }
}
