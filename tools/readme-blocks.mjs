/**
 * Reads a marked code block out of README.md: the fenced block between `<!-- NAME:start -->` and `<!-- NAME:end -->`.
 * The test that type-checks and renders the quickstart and the pack smoke that builds it against the tarball share this reader,
 * so both run the text a reader copies.
 */

/** Returns the source inside the fence of the block `name`; throws when a marker is missing, doubled, or the fence is not closed. */
export function extractReadmeBlock(readme, name) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const first = readme.indexOf(start);
  if (first === -1) throw new Error(`README.md has no ${start} marker`);
  if (readme.indexOf(start, first + 1) !== -1) throw new Error(`README.md has more than one ${start} marker`);
  const last = readme.indexOf(end, first);
  if (last === -1) throw new Error(`README.md has no ${end} marker after ${start}`);
  const between = readme.slice(first + start.length, last).trim();
  const open = /^```tsx\n/.exec(between);
  if (open === null) throw new Error(`the ${name} block does not open with a tsx fence`);
  if (!between.endsWith('\n```')) throw new Error(`the ${name} block does not close its fence`);
  const code = between.slice(open[0].length, between.length - 4);
  if (code.includes('```')) throw new Error(`the ${name} block holds a second fence`);
  return `${code}\n`;
}
