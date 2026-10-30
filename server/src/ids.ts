// Shared by every route that reads an id, a version, or a page number from a request.
//
// The upper bound is the largest value a Postgres INTEGER (Prisma Int) column holds. A number beyond it
// in a query makes Prisma throw, so it is refused here as no id, never answered with a 500 (review on
// Lab 4 #83).
export const MAX_INT4 = 2147483647;
export function isValidId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= MAX_INT4;
}
