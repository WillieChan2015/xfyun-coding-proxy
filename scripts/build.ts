import { rmSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');

// 清空产物目录
rmSync(dist, { recursive: true, force: true });

// bun build：编译 TS → 单文件 ESM bundle，所有 node_modules 包保持 external
const result = await Bun.build({
  entrypoints: [resolve(root, 'src/index.ts')],
  outdir: dist,
  target: 'node',
  format: 'esm',
  packages: 'external',
});

if (!result.success) {
  console.error('bun build failed:');
  for (const log of result.logs) console.error(' ', log);
  process.exit(1);
}

// tsc API：仅生成 .d.ts 类型声明（进程内执行，不启动子进程）
const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
if (!configPath) {
  console.error('tsconfig.json not found');
  process.exit(1);
}
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
parsed.options.declaration = true;
parsed.options.declarationMap = true;
parsed.options.emitDeclarationOnly = true;

const program = ts.createProgram(parsed.fileNames, parsed.options);
const emitResult = program.emit();
const allDiags = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
if (allDiags.length > 0) {
  for (const d of allDiags) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    const file = d.file ? `${d.file.fileName}: ` : '';
    console.error(`${file}${msg}`);
  }
  process.exit(1);
}

// pino transport 保持 .cjs 格式（Worker Thread 中 require() 加载）
cpSync(
  resolve(root, 'src/pretty-roll-transport.cjs'),
  resolve(dist, 'pretty-roll-transport.cjs'),
);
