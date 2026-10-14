// Preloaded into a child process: every module request the loader resolves is appended to the file named by PHONUX_RESOLVE_LOG.
import { register } from 'node:module';

register(new URL('./record-resolve-hooks.mjs', import.meta.url));
