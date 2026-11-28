/**
 * Whether the notices meant for development should print. `process.env.NODE_ENV` is read the way bundlers rewrite it, so a browser
 * bundle that defines it and has no `process` global still warns; a page with neither the rewrite nor a `process` reads as production.
 */

/** True outside a production build. @internal */
export function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}
