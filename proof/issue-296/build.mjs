// node build.mjs <phonux checkout> out.js
import { build } from 'esbuild';
const [lib, out] = process.argv.slice(2);
await build({
  entryPoints: ['entry.tsx'], bundle: true, outfile: out, jsx: 'automatic', format: 'esm',
  define: { 'process.env.NODE_ENV': '"development"' },
  alias: { LIB: lib }, nodePaths: [`${lib}/node_modules`], logLevel: 'warning',
});
