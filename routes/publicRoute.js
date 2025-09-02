// publicRoute.js

import express from 'express';
import { verifyToken } from '../middleware/verifyToken.js';
import publicController from '../controllers/publicController.js';
import asyncHandler from "express-async-handler";
import upload from '../service/fileUpload.js';
import logger from '../utils/logger.js';
import { formatFileSize } from '../utils/modelMapper.js';

const router = express.Router();

router.use(verifyToken);

// @route   POST /api/v1/search/:searchContent
router.get('/search/:searchContent', publicController.search);

// @route   POST /api/v1/upload-files
router.post(
    "/upload-files",
    upload.single("file"),
    asyncHandler(async (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded. Please check request format.",
            });
        }

        if (!req.file.location) {
            return res.status(400).json({
                success: false,
                message: "Upload failed. Could not store file in S3.",
            });
        }

        return res.status(201).json({
            success: true,
            message: "File uploaded successfully",
            fileUrl: req.file.location,
            fileName: req.file.key,
            mimeType: req.file.mimetype,
            size: formatFileSize(req.file.size),
        });
    })
);

export default router;