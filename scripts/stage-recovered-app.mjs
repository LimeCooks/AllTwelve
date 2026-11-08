import { readFile, writeFile, mkdir, copyFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.resolve(
  root,
  process.argv[2] ?? 'outputs/cloud-recovery-lab',
);
const auditPath = process.argv[3];
if (!auditPath || !target.startsWith(path.join(root, 'outputs') + path.sep))
  throw new Error(
    'Provide the isolated recovery checkout and its verified cloud row-audit file.',
  );
const marker = JSON.parse(
  await readFile(path.join(target, 'recovery-lab.json'), 'utf8'),
);
const pilot = JSON.parse(
  await readFile(path.join(root, '.openai/hosting.json'), 'utf8'),
);
const hosting = JSON.parse(
  await readFile(path.join(target, '.openai/hosting.json'), 'utf8'),
);
const audit = JSON.parse(await readFile(path.resolve(root, auditPath), 'utf8'));
if (
  marker.kind !== 'chalktalk-isolated-recovery-lab' ||
  !hosting.project_id ||
  hosting.project_id === pilot.project_id ||
  audit.project_id !== hosting.project_id ||
  audit.status !== 'passed' ||
  !Array.isArray(audit.checks) ||
  audit.checks.length !== 20 ||
  audit.checks.some((check) => check.exact !== true || check.complete !== true)
)
  throw new Error(
    'Recovery must be independently verified in its separate Site before application staging.',
  );
const clean = execFileSync('git', ['status', '--porcelain'], {
  cwd: root,
  windowsHide: true,
  encoding: 'utf8',
});
if (clean.trim())
  throw new Error(
    'Commit or resolve source changes before staging the recovered application.',
  );
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  windowsHide: true,
  encoding: 'utf8',
}).trim();
const files = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  windowsHide: true,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);
for (const relative of files) {
  if (relative === '.openai/hosting.json') continue;
  const source = path.resolve(root, relative),
    destination = path.resolve(target, relative);
  if (!source.startsWith(root) || !destination.startsWith(target + path.sep))
    throw new Error('Unsafe application source path.');
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}
// Remove only the explicitly generated recovery-only source files. Local
// rehearsal stores and the hosted database/files are never touched.
for (const relative of [
  'wrangler.json',
  'build.mjs',
  'src/worker.mjs',
  'src/index.html',
  'src/client.js',
  ...[
    'team-backup',
    'workspace-identity',
    'recovery-plan',
    'recovery-service',
    'recovery-chunks',
  ].map((name) => `src/${name}.ts`),
]) {
  const filename = path.resolve(target, relative);
  if (!filename.startsWith(target + path.sep))
    throw new Error('Unsafe recovery source path.');
  try {
    await unlink(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
await writeFile(
  path.join(target, '.openai/hosting.json'),
  JSON.stringify(hosting, null, 2),
);
await writeFile(
  path.join(target, 'recovery-lab.json'),
  JSON.stringify(
    {
      ...marker,
      phase: 'recovered-application',
      sourceBackupId: audit.source_backup_id,
      sourceCommit,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    checkout: target,
    project_id: hosting.project_id,
    phase: 'application source staged; not yet deployed',
  }),
);
