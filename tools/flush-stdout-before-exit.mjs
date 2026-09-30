// --test-force-exit ends each test child with process.exit(), which drops stdout still queued in a pipe.
// process.exit may return while stdout drains; nothing under test/ calls process.exit.
const realExit = process.exit.bind(process);
let exiting = false;
process.exit = (code) => {
  if (exiting) return;
  if (!process.stdout.writableLength) return realExit(code);
  exiting = true;
  setTimeout(() => realExit(code), 30_000).unref();
  process.stdout.write('', () => realExit(code));
};
