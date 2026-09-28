// Shared by the Lab 2 route bodies and the Lab 3 route modules.
export function isValidId(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
