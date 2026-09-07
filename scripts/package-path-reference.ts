/**
 * Explicit repository-root package references. A path inside an absolute URL
 * or a relative Markdown link has its own base and is not a checkout-root
 * reference; the Markdown-link checker owns local relative links.
 */
export const ROOT_PACKAGE_REFERENCE = /(?<![\w/])packages\/[A-Za-z0-9._/-]+/g
