import { DatabaseSync } from 'node:sqlite';
import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  stat,
  access,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';

const MAX_PART = 512 * 1024 * 1024,
  MAX_MANIFEST = 16 * 1024 * 1024;
const validKey = (key) =>
  typeof key === 'string' &&
  /^[a-z0-9][a-z0-9._/-]{0,159}$/i.test(key) &&
  key.split('/').every((p) => p && p !== '.' && p !== '..');
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
};

// Product prefixes may change; the ZIP schema and checksums remain authoritative.
const isManifest = (name) => /^[a-z][a-z0-9-]{0,40}-backup\.json$/.test(name);
function readPart(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    view.getUint32(end, true) !== 0x06054b50
  )
    end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50)
    throw new Error('A backup ZIP is incomplete. Download that part again.');
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    throw new Error('Unsupported ZIP disk format.');
  const entries = view.getUint16(end + 10, true);
  if (entries > 10001) throw new Error('Too many files in a backup part.');
  const expected = new Map();
  let offset = view.getUint32(end + 16, true),
    total = 0;
  for (let i = 0; i < entries; i++) {
    if (
      view.getUint32(offset, true) !== 0x02014b50 ||
      view.getUint16(offset + 10, true) !== 0
    )
      throw new Error(
        'Only the uncompressed AllTwelve backup format is supported.',
      );
    const length = view.getUint32(offset + 24, true),
      nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (expected.has(name))
      throw new Error('Duplicate file in backup archive.');
    if (
      !isManifest(name) &&
      (!name.startsWith('media/') || !validKey(name.slice(6)))
    )
      throw new Error('Unsafe or unexpected backup filename.');
    if (length > (isManifest(name) ? MAX_MANIFEST : MAX_PART))
      throw new Error('Backup entry exceeds its supported size.');
    total += length;
    if (total > MAX_PART + MAX_MANIFEST)
      throw new Error('Backup part is too large.');
    expected.set(name, { length, crc: view.getUint32(offset + 16, true) });
    offset +=
      46 +
      nameLength +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  const files = unzipSync(bytes, {
    filter: (entry) =>
      expected.has(entry.name) &&
      entry.originalSize === expected.get(entry.name).length,
  });
  for (const [name, info] of expected)
    if (
      !files[name] ||
      files[name].length !== info.length ||
      crc32(files[name]) !== info.crc
    )
      throw new Error(`Backup integrity check failed: ${name}`);
  if (Object.keys(files).filter(isManifest).length !== 1)
    throw new Error('Backup manifest is missing.');
  return files;
}

// Offline recovery only. This command never contacts a hosted database or R2.
// It refuses any existing output path and never replaces a live workspace.
export async function restoreBackup({ archives, output, ownerId }) {
  if (
    !archives.length ||
    typeof ownerId !== 'string' ||
    !ownerId.trim() ||
    ownerId.length > 200
  )
    throw new Error(
      'Provide all backup parts, a new output path, and an explicit recovery owner ID.',
    );
  const destination = path.resolve(output);
  try {
    await access(destination);
    throw new Error(
      'Recovery output already exists. Choose a new empty path; nothing was overwritten.',
    );
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let snapshot, canonical, database;
  const seenParts = new Set(),
    seenMedia = new Set(),
    mediaSha256 = {};
  await mkdir(destination, { recursive: true });
  await writeFile(
    path.join(destination, 'RESTORE_INCOMPLETE.txt'),
    'Recovery is incomplete. Do not use this folder as a live workspace.\n',
  );
  try {
    for (const archive of archives) {
      if (
        (await stat(archive)).size >
        MAX_PART + MAX_MANIFEST + 5 * 1024 * 1024
      )
        throw new Error('Archive exceeds the supported part size.');
      const files = readPart(await readFile(archive));
      const manifest = JSON.parse(
        new TextDecoder().decode(files[Object.keys(files).find(isManifest)]),
      );
      const { archivePart, ...metadata } = manifest;
      if (
        (typeof metadata.format !== 'string' || !/^[a-z][a-z0-9-]{0,40}-team-backup$/.test(metadata.format)) ||
        metadata.version !== 1 ||
        !Number.isInteger(metadata.parts) ||
        metadata.parts < 1 ||
        metadata.parts > 10000 ||
        !Number.isInteger(archivePart) ||
        archivePart < 1 ||
        archivePart > metadata.parts ||
        !Array.isArray(metadata.media) ||
        metadata.media.length > 10000 ||
        typeof metadata.teamId !== 'string'
      )
        throw new Error('Unsupported or invalid backup manifest.');
      if (seenParts.has(archivePart))
        throw new Error('The same backup part was supplied twice.');
      seenParts.add(archivePart);
      if (!snapshot) {
        snapshot = metadata;
        canonical = JSON.stringify(metadata);
      } else if (JSON.stringify(metadata) !== canonical)
        throw new Error('These parts belong to different backups.');
      const expectedFiles = new Map(
        metadata.media
          .filter((m) => m.part === archivePart)
          .map((m) => [m.key, m]),
      );
      for (const [name, bytes] of Object.entries(files)) {
        if (isManifest(name)) continue;
        const key = name.slice(6),
          info = expectedFiles.get(key);
        if (
          !validKey(key) ||
          !info ||
          seenMedia.has(key) ||
          info.size !== bytes.length
        )
          throw new Error('Backup file does not match its manifest.');
        if (
          /^[0-9a-f]{32}$/i.test(info.etag) &&
          createHash('md5').update(bytes).digest('hex') !==
            info.etag.toLowerCase()
        )
          throw new Error(`File checksum mismatch: ${key}`);
        const filename = path.resolve(destination, 'media', key);
        if (!filename.startsWith(path.join(destination, 'media') + path.sep))
          throw new Error('Unsafe recovery path.');
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, bytes, { flag: 'wx' });
        mediaSha256[key] = createHash('sha256').update(bytes).digest('hex');
        seenMedia.add(key);
      }
      for (const key of expectedFiles.keys())
        if (!seenMedia.has(key))
          throw new Error(`A backup file is missing: ${key}`);
    }
    if (
      !snapshot ||
      seenParts.size !== snapshot.parts ||
      seenMedia.size !== snapshot.media.length
    )
      throw new Error('Not all backup parts were provided.');
    database = new DatabaseSync(path.join(destination, 'workspace.sqlite'));
    for (const name of (await readdir(new URL('../drizzle/', import.meta.url)))
      .filter((n) => n.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b)))
      database.exec(
        await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'),
      );
    database.exec('PRAGMA foreign_keys = ON');
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('workspace_owners','team_invitations','team_memberships') ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    if (
      !snapshot.tables ||
      JSON.stringify(Object.keys(snapshot.tables).sort()) !==
        JSON.stringify(tables)
    )
      throw new Error(
        'The backup tables do not match this recovery tool’s schema.',
      );
    if (
      snapshot.tables.teams.length !== 1 ||
      snapshot.tables.teams[0].id !== snapshot.teamId
    )
      throw new Error('The backup must contain exactly its own team.');
    const order = [
      'teams',
      'athletes',
      'games',
      'formations',
      'playbooks',
      'plays',
      'play_assignments',
      'depth_charts',
      'depth_assignments',
      'install_packages',
      'install_items',
      'athlete_reviews',
      'calendar_events',
      'practice_plans',
      'conversations',
      'messages',
      'film_assets',
      'film_clips',
      'workspace_state',
    ];
    database.exec('BEGIN');
    for (const table of order) {
      const columns = database
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((r) => r.name);
      const statement = database.prepare(
        `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      );
      if (!Array.isArray(snapshot.tables[table]))
        throw new Error('Invalid backup rows.');
      for (const row of snapshot.tables[table]) {
        if (
          !row ||
          JSON.stringify(Object.keys(row).sort()) !==
            JSON.stringify([...columns].sort((a, b) => a.localeCompare(b))) ||
          ('team_id' in row && row.team_id !== snapshot.teamId)
        )
          throw new Error('Invalid or cross-team backup record.');
        const values = columns.map((column) => row[column]);
        if (
          values.some(
            (v) =>
              v !== null &&
              typeof v !== 'string' &&
              (typeof v !== 'number' || !Number.isFinite(v)),
          )
        )
          throw new Error('Invalid database value in backup.');
        statement.run(...values);
      }
    }
    database
      .prepare(
        'INSERT INTO workspace_owners (user_id, team_id, created_at) VALUES (?, ?, ?)',
      )
      .run(ownerId.trim(), snapshot.teamId, new Date().toISOString());
    if (database.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Backup relationships are incomplete.');
    database.exec('COMMIT');
    database.close();
    database = undefined;
    await writeFile(
      path.join(destination, 'recovery.json'),
      JSON.stringify(
        {
          complete: true,
          backupId: snapshot.id,
          backupCreatedAt: snapshot.createdAt,
          teamId: snapshot.teamId,
          mediaFiles: seenMedia.size,
          ownerId: ownerId.trim(),
          media: snapshot.media,
          mediaSha256,
          parts: snapshot.parts,
          mediaBytes: snapshot.mediaBytes,
        },
        null,
        2,
      ),
    );
    await unlink(path.join(destination, 'RESTORE_INCOMPLETE.txt'));
    return {
      output: destination,
      teamId: snapshot.teamId,
      mediaFiles: seenMedia.size,
    };
  } catch (error) {
    if (database) {
      try {
        database.exec('ROLLBACK');
      } catch {}
      database.close();
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2),
    out = args.indexOf('--out'),
    owner = args.indexOf('--owner-id');
  if (out < 0 || owner < 0 || !args[out + 1] || !args[owner + 1]) {
    console.error(
      'Usage: node scripts/restore-backup.mjs --out NEW_FOLDER --owner-id RECOVERY_OWNER_ID PART1.zip [PART2.zip ...]',
    );
    process.exitCode = 1;
  } else {
    const archives = args
      .filter(
        (_, i) => i !== out && i !== out + 1 && i !== owner && i !== owner + 1,
      )
      .map((name) => path.resolve(name));
    try {
      console.log(
        JSON.stringify(
          await restoreBackup({
            archives,
            output: args[out + 1],
            ownerId: args[owner + 1],
          }),
        ),
      );
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : 'Recovery failed.',
      );
      process.exitCode = 1;
    }
  }
}
