import { describe, expect, it } from "vitest";
import { validateAttachment } from "../../src/attachmentValidation.js";

const validFile = { originalFilename: "receipt.jpg", mimeType: "image/jpeg", sizeBytes: 1024 };

describe("validateAttachment", () => {
  it("accepts a valid JPG under the size limit with room in the active count", () => {
    expect(validateAttachment(validFile, 0)).toBeNull();
  });

  it("rejects a disallowed extension/MIME with UNSUPPORTED_TYPE", () => {
    expect(
      validateAttachment({ ...validFile, originalFilename: "notes.docx", mimeType: "application/msword" }, 0),
    ).toBe("UNSUPPORTED_TYPE");
  });

  it("rejects a mismatched extension/MIME pair with UNSUPPORTED_TYPE", () => {
    expect(validateAttachment({ ...validFile, originalFilename: "fake.jpg", mimeType: "application/msword" }, 0)).toBe(
      "UNSUPPORTED_TYPE",
    );
  });

  it("rejects a file over 5 MB with FILE_TOO_LARGE", () => {
    expect(validateAttachment({ ...validFile, sizeBytes: 6 * 1024 * 1024 }, 0)).toBe("FILE_TOO_LARGE");
  });

  it("accepts exactly 5 MB", () => {
    expect(validateAttachment({ ...validFile, sizeBytes: 5 * 1024 * 1024 }, 0)).toBeNull();
  });

  it("rejects a 6th active attachment with MAX_ATTACHMENTS_EXCEEDED", () => {
    expect(validateAttachment(validFile, 5)).toBe("MAX_ATTACHMENTS_EXCEEDED");
  });

  it("accepts the 5th active attachment", () => {
    expect(validateAttachment(validFile, 4)).toBeNull();
  });
});
