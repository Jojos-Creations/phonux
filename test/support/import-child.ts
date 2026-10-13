// The child process of the import-path test: imports one module of the library by name, and where that module makes workspaces, makes one with no document.
export {};
const which = process.argv[2];
if (which === 'workspaceCore') {
  const { createWorkspace } = await import('../../workspaceCore.js');
  const ws = createWorkspace({});
  ws.dispose();
} else if (which === 'autoMount') {
  await import('../../autoMount.js');
} else {
  throw new Error(`unknown module ${which}`);
}
