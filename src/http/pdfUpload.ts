import multer from "multer";

const MAX_PDF_BYTES = 48 * 1024 * 1024;

export const curriculumPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const name = String(file.originalname || "").toLowerCase();
    const okType = file.mimetype === "application/pdf" || name.endsWith(".pdf");
    if (!okType) {
      cb(new Error("Envie um arquivo PDF (.pdf)."));
      return;
    }
    cb(null, true);
  },
});
