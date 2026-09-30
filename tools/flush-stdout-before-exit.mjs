// --test-force-exit ends each test child with process.exit(), which drops stdout still queued in a pipe.
// The override returns while stdout drains; no suite test file calls process.exit itself, so nothing relies on it never returning.
const realExit = process.exit.bind(process);
let exiting = false;
// Arguments pass through untouched: a bare exit() must keep process.exitCode.
process.exit = (...args) => {
  if (exiting) return;
  if (!process.stdout.writableLength) return realExit(...args);
  exiting = true;
  // A parent that never drains the pipe must not hold the child forever.
  setTimeout(() => realExit(...args), 30_000).unref();
  process.stdout.write('', () => realExit(...args));
};
