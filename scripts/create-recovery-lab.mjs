import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  cp,
  access,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.resolve(
  root,
  process.argv[2] ?? 'outputs/cloud-recovery-lab',
);
const updating = process.argv.includes('--update');
if (!target.startsWith(path.join(root, 'outputs') + path.sep))
  throw new Error('Create the isolated recovery checkout inside outputs.');
if (updating) {
  const marker = JSON.parse(
    await readFile(path.join(target, 'recovery-lab.json'), 'utf8'),
  );
  if (marker.kind !== 'alltwelve-isolated-recovery-lab')
    throw new Error('This folder is not a recovery lab.');
  const [pilot, lab] = await Promise.all([
    readFile(path.join(root, '.openai/hosting.json'), 'utf8'),
    readFile(path.join(target, '.openai/hosting.json'), 'utf8'),
  ]);
  if (JSON.parse(pilot).project_id === JSON.parse(lab).project_id)
    throw new Error('The recovery lab cannot use the pilot project.');
} else {
  try {
    await access(target);
    throw new Error(
      'The recovery checkout already exists. Reuse its recorded Site instead of creating another.',
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(target);
  await mkdir(path.join(target, '.openai'));
  await writeFile(
    path.join(target, '.openai/hosting.json'),
    JSON.stringify({ d1: 'DB', r2: 'MEDIA' }, null, 2),
  );
  await writeFile(
    path.join(target, 'recovery-lab.json'),
    JSON.stringify({ kind: 'alltwelve-isolated-recovery-lab' }),
  );
  await writeFile(
    path.join(target, '.gitignore'),
    'node_modules/\ndist/\n.wrangler/\n',
  );
}
await mkdir(path.join(target, 'src'), { recursive: true });
for (const name of [
  'team-backup',
  'workspace-identity',
  'recovery-plan',
  'recovery-service',
  'recovery-chunks',
])
  await copyFile(
    path.join(root, 'lib', name + '.ts'),
    path.join(target, 'src', name + '.ts'),
  );
for (const [source, destination] of [
  ['worker-template.mjs', 'src/worker.mjs'],
  ['index.html', 'src/index.html'],
  ['client.js', 'src/client.js'],
  ['build-template.mjs', 'build.mjs'],
])
  await copyFile(
    path.join(root, 'recovery', source),
    path.join(target, destination),
  );
await cp(path.join(root, 'drizzle'), path.join(target, 'drizzle'), {
  recursive: true,
});
await writeFile(
  path.join(target, 'package.json'),
  JSON.stringify(
    {
      name: 'alltwelve-recovery-lab',
      private: true,
      type: 'module',
      scripts: { build: 'node build.mjs' },
      devDependencies: { typescript: '5.9.3', wrangler: '4.92.0' },
    },
    null,
    2,
  ),
);
await writeFile(
  path.join(target, 'wrangler.json'),
  JSON.stringify(
    {
      name: 'alltwelve-recovery-lab',
      main: 'dist/server/index.js',
      compatibility_date: '2026-05-15',
      compatibility_flags: ['nodejs_compat'],
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'recovery-lab',
          database_id: '00000000-0000-4000-8000-000000000000',
          migrations_dir: 'drizzle',
        },
      ],
      r2_buckets: [{ binding: 'MEDIA', bucket_name: 'recovery-lab' }],
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ checkout: target, updated: updating }));
