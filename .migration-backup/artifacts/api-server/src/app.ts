import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
await mkdir(UPLOADS_DIR, { recursive: true });

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Serve uploaded media files
app.use("/api/media", express.static(UPLOADS_DIR, {
  maxAge: "1d",
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if ([".mp4", ".mov", ".avi"].includes(ext)) {
      res.setHeader("Content-Type", "video/mp4");
    }
  },
}));

app.use("/api", router);

export default app;
