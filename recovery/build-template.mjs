import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  copyFile,
} from 'node:fs/promises';
import ts from 'typescript';
await mkdir('dist/server', { recursive: true });
for (const name of (await readdir('src')).filter((name) =>
  name.endsWith('.ts'),
)) {
  const source = (await readFile('src/' + name, 'utf8')).replace(
    /(['"])@\/lib\/([^'"]+)\1/g,
    (_, quote, module) => quote + './' + module + '.js' + quote,
  );
  await writeFile(
    'dist/server/' + name.replace(/\.ts$/, '.js'),
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText,
  );
}
await copyFile('src/worker.mjs', 'dist/server/index.js');
await writeFile(
  'dist/server/page.js',
  'export default ' +
    JSON.stringify(await readFile('src/index.html', 'utf8')) +
    ';',
);
await writeFile(
  'dist/server/client.js',
  'export default ' +
    JSON.stringify(await readFile('src/client.js', 'utf8')) +
    ';',
);
console.log('Built isolated recovery Worker.');
