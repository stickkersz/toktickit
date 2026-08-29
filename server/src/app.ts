import { unlink } from "node:fs/promises";
import path from "node:path";
import express, { Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import { getPrisma } from "./prisma.js";
import {
  validateSummary,
  validateDescription,
  validateRequestedPriority,
  validateRemovalReason,
} from "./validation.js";
import { formatTicketNumber } from "./ticketNumber.js";
import { validateAttachment, ATTACHMENT_REJECT_MESSAGES } from "./attachmentValidation.js";
import { UPLOAD_DIR, ensureUploadDir, generateStoredFilename } from "./attachmentStorage.js";
import { parseTicketListQuery } from "./ticketListQuery.js";

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
function isValidId(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

// Shared shape for endpoints 6, 8, 10 (api-spec.md): removedAt/removalReason
// are only present once BR-30 actually applies (isRemoved: true).
function serializeAttachment(attachment: {
  id: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
  isRemoved: boolean;
  removedAt: Date | null;
  removalReason: string | null;
}) {
  const base = {
    id: attachment.id,
    originalFilename: attachment.originalFilename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    uploadedAt: attachment.uploadedAt,
    isRemoved: attachment.isRemoved,
  };
  if (!attachment.isRemoved) return base;
  return { ...base, removedAt: attachment.removedAt, removalReason: attachment.removalReason };
}

app.post("/api/tickets", async (req: Request, res: Response) => {
  try {
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

    if (!isValidId(requesterId)) {
      fields.requesterId = "A valid requesterId is required.";
    } else if (!(await getPrisma().requesterUser.findFirst({ where: { id: requesterId, isActive: true } }))) {
      fields.requesterId = "requesterId must reference an active Requester.";
    }

    if (!isValidId(categoryId)) {
      fields.categoryId = "A valid categoryId is required.";
    } else if (!(await getPrisma().category.findFirst({ where: { id: categoryId, isActive: true } }))) {
      fields.categoryId = "categoryId must reference an active Category.";
    }

    if (!isValidId(relatedSystemId)) {
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

    // Files already persisted as an Attachment row (or already rejected and
    // unlinked inline) must never be swept up by the catch block's cleanup:
    // only files still unprocessed when a later file throws are unsettled.
    const settledFilenames = new Set<string>();
    const cleanupUnsettledFiles = () =>
      Promise.all(
        files
          .filter((file) => !settledFilenames.has(file.filename))
          .map((file) => unlink(path.join(UPLOAD_DIR, file.filename)).catch(() => {})),
      );

    if (!isValidId(requesterId)) {
      await cleanupUnsettledFiles();
      return res
        .status(400)
        .json({ error: "VALIDATION_ERROR", message: "A valid requesterId is required." });
    }

    if (!isValidId(ticketId)) {
      await cleanupUnsettledFiles();
      return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
    }

    try {
      const ticket = await getPrisma().ticket.findFirst({
        where: { id: ticketId, requesterId },
        include: { attachments: { where: { isRemoved: false } } },
      });

      if (!ticket) {
        await cleanupUnsettledFiles();
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
          settledFilenames.add(file.filename);
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
        settledFilenames.add(file.filename);
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
      await cleanupUnsettledFiles();
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Unable to process the upload." });
    }
  },
);

// ---------------------------------------------------------------------------
// Lab 2 — My Tickets
// GET /api/tickets (api-spec.md §5, FR-04, BR-20..24a).
// ---------------------------------------------------------------------------
app.get("/api/tickets", async (req: Request, res: Response) => {
  try {
    const requesterId = Number(req.query.requesterId);
    if (
      !isValidId(requesterId) ||
      !(await getPrisma().requesterUser.findFirst({ where: { id: requesterId, isActive: true } }))
    ) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "requesterId is required and must reference an active Requester.",
      });
    }

    const query = parseTicketListQuery(req.query as Record<string, unknown>);

    const where: Record<string, unknown> = { requesterId };
    if (query.search) {
      where.OR = [
        { ticketNumber: { contains: query.search, mode: "insensitive" } },
        { summary: { contains: query.search, mode: "insensitive" } },
      ];
    }
    if (query.categoryId !== null) where.categoryId = query.categoryId;
    if (query.requestedPriority !== null) where.requestedPriority = query.requestedPriority;
    if (query.currentStatus !== null) where.currentStatus = query.currentStatus;

    const { page, pageSize, sortField, sortDirection } = query;

    const [total, tickets] = await Promise.all([
      getPrisma().ticket.count({ where }),
      getPrisma().ticket.findMany({
        where,
        orderBy: [{ [sortField]: sortDirection }, { id: sortDirection }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: { select: { name: true } } },
      }),
    ]);

    res.status(200).json({
      data: tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        summary: ticket.summary,
        categoryName: ticket.category.name,
        requestedPriority: ticket.requestedPriority,
        currentStatus: ticket.currentStatus,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch {
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unable to load tickets." });
  }
});

// ---------------------------------------------------------------------------
// Lab 2 — Requester Ticket Detail
// GET /api/tickets/:id (api-spec.md §6, FR-05).
// ---------------------------------------------------------------------------
app.get("/api/tickets/:id", async (req: Request, res: Response) => {
  try {
    const ticketId = Number(req.params.id);
    const requesterId = Number(req.query.requesterId);

    if (!isValidId(requesterId)) {
      return res
        .status(400)
        .json({ error: "VALIDATION_ERROR", message: "A valid requesterId is required." });
    }

    if (!isValidId(ticketId)) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
    }

    const ticket = await getPrisma().ticket.findFirst({
      where: { id: ticketId, requesterId },
      include: {
        requester: { select: { name: true } },
        category: { select: { name: true } },
        relatedSystem: { select: { name: true } },
        attachments: { orderBy: { uploadedAt: "desc" } },
      },
    });

    if (!ticket) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
    }

    res.status(200).json({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      requesterId: ticket.requesterId,
      requesterName: ticket.requester.name,
      categoryId: ticket.categoryId,
      categoryName: ticket.category.name,
      relatedSystemId: ticket.relatedSystemId,
      relatedSystemName: ticket.relatedSystem.name,
      summary: ticket.summary,
      description: ticket.description,
      requestedPriority: ticket.requestedPriority,
      currentStatus: ticket.currentStatus,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      attachments: ticket.attachments.map(serializeAttachment),
    });
  } catch {
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unable to load the Ticket." });
  }
});

// ---------------------------------------------------------------------------
// Lab 2 — Attachment metadata/download/removal
// GET /api/attachments/:id, GET /api/attachments/:id/download,
// DELETE /api/attachments/:id (api-spec.md §8-10, FR-07/FR-08, BR-29/BR-30).
// ---------------------------------------------------------------------------
app.get("/api/attachments/:id", async (req: Request, res: Response) => {
  try {
    const attachmentId = Number(req.params.id);
    const requesterId = Number(req.query.requesterId);

    if (!isValidId(requesterId)) {
      return res
        .status(400)
        .json({ error: "VALIDATION_ERROR", message: "A valid requesterId is required." });
    }

    if (!isValidId(attachmentId)) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Attachment not found." });
    }

    const attachment = await getPrisma().attachment.findFirst({
      where: { id: attachmentId, ticket: { requesterId } },
    });

    if (!attachment) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Attachment not found." });
    }

    res.status(200).json(serializeAttachment(attachment));
  } catch {
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unable to load the attachment." });
  }
});

app.get("/api/attachments/:id/download", async (req: Request, res: Response) => {
  try {
    const attachmentId = Number(req.params.id);
    const requesterId = Number(req.query.requesterId);

    if (!isValidId(requesterId)) {
      return res
        .status(400)
        .json({ error: "VALIDATION_ERROR", message: "A valid requesterId is required." });
    }

    if (!isValidId(attachmentId)) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Attachment not found." });
    }

    const attachment = await getPrisma().attachment.findFirst({
      where: { id: attachmentId, ticket: { requesterId } },
    });

    if (!attachment) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Attachment not found." });
    }

    if (attachment.isRemoved) {
      return res
        .status(410)
        .json({ error: "ATTACHMENT_REMOVED", message: "This attachment has been removed." });
    }

    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${attachment.originalFilename.replace(/"/g, "")}"`,
    );
    res.sendFile(path.join(UPLOAD_DIR, attachment.storedFilename), (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Unable to download the file." });
      }
    });
  } catch {
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unable to download the file." });
  }
});

app.delete("/api/attachments/:id", async (req: Request, res: Response) => {
  try {
    const attachmentId = Number(req.params.id);
    const requesterId = Number(req.body?.requesterId);

    if (!isValidId(requesterId)) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "A valid requesterId is required.",
        fields: { requesterId: "A valid requesterId is required." },
      });
    }

    const reasonResult = validateRemovalReason(req.body?.reason);
    if (reasonResult.error) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: reasonResult.error,
        fields: { reason: reasonResult.error },
      });
    }

    if (!isValidId(attachmentId)) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Attachment not found." });
    }

    const attachment = await getPrisma().attachment.findFirst({
      where: { id: attachmentId, ticket: { requesterId } },
    });

    if (!attachment) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Attachment not found." });
    }

    if (attachment.isRemoved) {
      return res
        .status(409)
        .json({ error: "ALREADY_REMOVED", message: "This attachment is already removed." });
    }

    const updated = await getPrisma().attachment.update({
      where: { id: attachmentId },
      data: { isRemoved: true, removedAt: new Date(), removalReason: reasonResult.value },
    });

    res.status(200).json(serializeAttachment(updated));
  } catch {
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unable to remove the attachment." });
  }
});

export default app;
