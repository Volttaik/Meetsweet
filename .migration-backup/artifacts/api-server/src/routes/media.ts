import { Router, type IRouter } from "express";
import multer from "multer";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth.js";
import { query } from "../lib/db.js";

const router: IRouter = Router();

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
await mkdir(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/mov": "video",
  "video/x-msvideo": "video",
};

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// ─── POST /api/media/upload ───────────────────────────────────────────────────

router.post(
  "/media/upload",
  requireAuth,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: "File too large. Maximum size is 100 MB." });
        } else {
          res.status(400).json({ error: err.message });
        }
        return;
      }
      if (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      next();
    });
  },
  async (req: AuthRequest, res) => {
    try {
      const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const mediaType = ALLOWED_MIME[file.mimetype] ?? "image";
      // Build a URL that works from both the Expo device and the proxied preview.
      const configuredOrigin = process.env.API_BASE_URL
        ?.replace(/\/api\/?$/, "")
        .replace(/\/$/, "");
      const origin = configuredOrigin
        ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
      const fileUrl = `${origin}/api/media/${file.filename}`;

      await query(
        `INSERT INTO media
          (id, user_id, url, thumbnail_url, media_type, filename, original_name, mime_type, file_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          uuidv4(),
          req.user!.sub,
          fileUrl,
          mediaType === "image" ? fileUrl : null,
          mediaType,
          file.filename,
          file.originalname,
          file.mimetype,
          file.size,
        ],
      );

      res.json({
        url: fileUrl,
        thumbnailUrl: mediaType === "image" ? fileUrl : null,
        type: mediaType,
        size: file.size,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
      });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

export default router;
