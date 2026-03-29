/**
 * Sanitize video title to create a valid directory name in kebab-case
 */
export function sanitizeVideoName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
