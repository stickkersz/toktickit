// BR-01/specification.md §7's justified decision: the numeric suffix comes
// from ticket_number_seq (SELECT nextval() before insert), never the row's
// own autoincrement id or a "max + 1" query.
export function formatTicketNumber(year: number, sequenceValue: number | bigint): string {
  return `TKT-${year}-${String(sequenceValue).padStart(6, "0")}`;
}
