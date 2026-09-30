// --test-force-exit ends each test child with process.exit(), which drops stdout still queued in a pipe.
// process.exit may return while stdout drains; nothing under test/ calls process.exit.
const realExit = process.exit.bind(process);
let exiting = false;
// Arguments pass through untouched: a bare exit() must keep process.exitCode.
process.exit = (...args) => {
  if (exiting) return;
  if (!process.stdout.writableLength) return realExit(...args);
  exiting = true;
  setTimeout(() => realExit(...args), 30_000).unref();
  process.stdout.write('', () => realExit(...args));
};
