export function normalizeOrganizationSlug(value: string): string {
  return value.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");
}

export function isValidOrganizationSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
