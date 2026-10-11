/**
 * The npm command text the release check prints for a person to run by hand. It only builds a string: nothing in
 * this file starts a process.
 */

// A prerelease must never take the registry's default tag, or an install of plain `phonux` would pick it up.
const PRERELEASE = /^\d+\.\d+\.\d+-/;

export function publishCommand(version, distDir) {
  const tag = PRERELEASE.test(version) ? ' --tag next' : '';
  return `cd ${distDir} && npm publish${tag}`;
}
