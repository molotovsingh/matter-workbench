export function lookupString<T extends Record<string, string>>(
  values: T,
  key: string,
  fallback: string,
): string {
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key as keyof T] : fallback;
}
