import type { Response } from "express";

// Lab 3 error envelope (api-spec.md, "Error shape"): { error, message, fields? }.
// Used by new code only. The Lab 2 inline error sites are deliberately untouched.
export function sendError(
  res: Response,
  status: number,
  error: string,
  message: string,
  fields?: Record<string, string>,
) {
  return res.status(status).json(fields ? { error, message, fields } : { error, message });
}
