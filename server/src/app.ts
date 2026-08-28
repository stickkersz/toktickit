import { unlink } from "node:fs/promises";
import path from "node:path";
import express, { Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import { getPrisma } from "./prisma.js";
import { validateSummary, validateDescription, validateRequestedPriority } from "./validation.js";
import { formatTicketNumber } from "./ticketNumber.js";
import { validateAttachment, ATTACHMENT_REJECT_MESSAGES } from "./attachmentValidation.js";
import { UPLOAD_DIR, ensureUploadDir, generateStoredFilename } from "./attachmentStorage.js";

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureUploadDir();
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => cb(null, generateStoredFilename(file.originalname)),
  }),
});

// The Express app is exported separately from app.listen() (see index.ts) so
// Supertest can import `app` without opening a port. Do not merge these files.
export const app = express();

app.use(cors());          // already wired: lets the Vite dev server call this API
app.use(express.json());

// ---------------------------------------------------------------------------
// Issue 2 — API health check
// Make the test in tests/lab-01/health.test.ts pass.
// It must return HTTP 200 with JSON: { status: "ok", service: "TokTickIT API" }
// ---------------------------------------------------------------------------
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", service: "TokTickIT API" });
});

// ---------------------------------------------------------------------------
// Issue 4 — Category list
// GET /api/categories -> read categories from PostgreSQL via Prisma,
// return each { id, name } in id order. On failure, respond 500 safely.
// Lab 2 (api-spec.md §1) filters to isActive: true.
// ---------------------------------------------------------------------------
app.get("/api/categories", async (_req: Request, res: Response) => {
  try {
    const categories = await getPrisma().category.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    });
    res.status(200).json(categories);
  } catch {
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unable to load categories." });
  }
});

// ---------------------------------------------------------------------------
// Lab 2 — Create Ticket reference data
// GET /api/related-systems -> active Related Systems (api-spec.md §2, BR-15).
// ---------------------------------------------------------------------------
app.get("/api/related-systems", async (_req: Request, res: Response) => {
  try {
    const relatedSystems = await getPrisma().relatedSystem.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    });
    res.status(200).json(relatedSystems);
  } catch {
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unable to load related systems." });
  }
});

// ---------------------------------------------------------------------------
// Lab 2 — Development Requester Selection
// GET /api/requesters -> active Development Requesters (api-spec.md §3, BR-04).
// ---------------------------------------------------------------------------
app.get("/api/requesters", async (_req: Request, res: Response) => {
  try {
    const requesters = await getPrisma().requesterUser.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { id: "asc" },
    });
    res.status(200).json(requesters);
  } catch {
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unable to load requesters." });
  }
});

// ---------------------------------------------------------------------------
// Lab 2 — Create Ticket
// POST /api/tickets (api-spec.md §4, FR-02/FR-03, BR-01/BR-08/BR-09/BR-13..19).
// ---------------------------------------------------------------------------
app.post("/api/tickets", async (req: Request, res: Response) => {
  const fields: Record<string, string> = {};

  const summaryResult = validateSummary(req.body?.summary);
  if (summaryResult.error) fields.summary = summaryResult.error;

  const descriptionResult = validateDescription(req.body?.description);
  if (descriptionResult.error) fields.description = descriptionResult.error;

  const priorityResult = validateRequestedPriority(req.body?.requestedPriority);
  if (priorityResult.error) fields.requestedPriority = priorityResult.error;

  const requesterId = Number(req.body?.requesterId);
  const categoryId = Number(req.body?.categoryId);
  const relatedSystemId = Number(req.body?.relatedSystemId);

  if (!Number.isFinite(requesterId)) {
    fields.requesterId = "A valid requesterId is required.";
  } else if (!(await getPrisma().requesterUser.findFirst({ where: { id: requesterId, isActive: true } }))) {
    fields.requesterId = "requesterId must reference an active Requester.";
  }

  if (!Number.isFinite(categoryId)) {
    fields.categoryId = "A valid categoryId is required.";
  } else if (!(await getPrisma().category.findFirst({ where: { id: categoryId, isActive: true } }))) {
    fields.categoryId = "categoryId must reference an active Category.";
  }

  if (!Number.isFinite(relatedSystemId)) {
    fields.relatedSystemId = "A valid relatedSystemId is required.";
  } else if (
    !(await getPrisma().relatedSystem.findFirst({ where: { id: relatedSystemId, isActive: true } }))
  ) {
    fields.relatedSystemId = "relatedSystemId must reference an active Related System.";
  }

  if (Object.keys(fields).length > 0) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: Object.values(fields)[0],
      fields,
    });
  }

  try {
    // BR-19/§7's justified decision: the sequence value is fetched and the
    // Ticket inserted in the same transaction, so a failure leaves no
    // partial row and no gap between "number known" and "row exists".
    const ticket = await getPrisma().$transaction(async (tx) => {
      const [{ nextval }] = await tx.$queryRaw<
        { nextval: bigint }[]
      >`SELECT nextval('ticket_number_seq') AS nextval`;
      const ticketNumber = formatTicketNumber(new Date().getFullYear(), nextval);

      return tx.ticket.create({
        data: {
          ticketNumber,
          requesterId,
          categoryId,
          relatedSystemId,
          summary: summaryResult.value!,
          description: descriptionResult.value!,
          requestedPriority: priorityResult.value!,
        },
      });
    });

    res.status(201).json({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      requesterId: ticket.requesterId,
      categoryId: ticket.categoryId,
      relatedSystemId: ticket.relatedSystemId,
      summary: ticket.summary,
      description: ticket.description,
      requestedPriority: ticket.requestedPriority,
      currentStatus: ticket.currentStatus,
      createdAt: ticket.createdAt,
    });
  } catch {
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unable to create the Ticket." });
  }
});

// ---------------------------------------------------------------------------
// Lab 2 — Attachments on Create/Ticket Detail
// POST /api/tickets/:id/attachments (api-spec.md §7, FR-06, BR-25/26/27/31).
// ---------------------------------------------------------------------------
app.post(
  "/api/tickets/:id/attachments",
  upload.array("files"),
  async (req: Request, res: Response) => {
    const ticketId = Number(req.params.id);
    const requesterId = Number(req.body?.requesterId);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    const cleanupFiles = () =>
      Promise.all(files.map((file) => unlink(path.join(UPLOAD_DIR, file.filename)).catch(() => {})));

    if (!Number.isFinite(requesterId)) {
      await cleanupFiles();
      return res
        .status(400)
        .json({ error: "VALIDATION_ERROR", message: "A valid requesterId is required." });
    }

    if (!Number.isFinite(ticketId)) {
      await cleanupFiles();
      return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
    }

    try {
      const ticket = await getPrisma().ticket.findFirst({
        where: { id: ticketId, requesterId },
        include: { attachments: { where: { isRemoved: false } } },
      });

      if (!ticket) {
        await cleanupFiles();
        return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
      }

      if (files.length === 0) {
        return res
          .status(400)
          .json({ error: "VALIDATION_ERROR", message: "At least one file is required." });
      }

      const uploaded: Record<string, unknown>[] = [];
      const failed: { originalFilename: string; reason: string; message: string }[] = [];
      let activeCount = ticket.attachments.length;

      for (const file of files) {
        const reason = validateAttachment(
          { originalFilename: file.originalname, mimeType: file.mimetype, sizeBytes: file.size },
          activeCount,
        );

        if (reason) {
          await unlink(path.join(UPLOAD_DIR, file.filename)).catch(() => {});
          failed.push({
            originalFilename: file.originalname,
            reason,
            message: ATTACHMENT_REJECT_MESSAGES[reason],
          });
          continue;
        }

        const attachment = await getPrisma().attachment.create({
          data: {
            ticketId: ticket.id,
            originalFilename: file.originalname,
            storedFilename: file.filename,
            mimeType: file.mimetype,
            sizeBytes: file.size,
          },
        });
        activeCount += 1;

        uploaded.push({
          id: attachment.id,
          originalFilename: attachment.originalFilename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          uploadedAt: attachment.uploadedAt,
          isRemoved: attachment.isRemoved,
        });
      }

      if (uploaded.length === 0) {
        return res.status(400).json({
          error: "ALL_FILES_REJECTED",
          message: "No files could be attached.",
          uploaded,
          failed,
        });
      }

      res.status(201).json({ uploaded, failed });
    } catch {
      await cleanupFiles();
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Unable to process the upload." });
    }
  },
);

export default app;
