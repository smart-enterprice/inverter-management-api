// bulkImportRoute.js - excelupload
import express from "express";
import multer from "multer";

import { verifyToken } from "../middleware/verifyToken.js";
import { BadRequestException } from "../middleware/CustomError.js";
import bulkImportController from "../controllers/bulkImportController.js";

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = [
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            // Some browsers/OS send a generic type for .xlsx
            "application/octet-stream",
        ];
        // Legacy .xls is no longer supported (exceljs reads .xlsx only)
        if (
            allowed.includes(file.mimetype) ||
            file.originalname.match(/\.xlsx$/i)
        ) {
            cb(null, true);
        } else {
            cb(new BadRequestException("Only .xlsx files are accepted."), false);
        }
    },
});

router.use(verifyToken);

router.post(
    "/upload",
    upload.single("file"),
    bulkImportController.uploadAndImport
);

router.get("/template", bulkImportController.getTemplate);

export default router;