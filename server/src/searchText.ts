// Prisma's `contains` builds a SQL LIKE pattern without escaping it, so a typed "%" or "_"
// would act as a wildcard and "\\" as an escape instead of matching itself. Search text is
// just text, so those three characters are escaped before it reaches the query. (This is
// not an injection risk: the value is always a bound parameter.)
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}
