// fileUpload.js

import { S3Client } from "@aws-sdk/client-s3";
import multer from "multer";
import multerS3 from "multer-s3";
import { AWS_ACCESS_KEY_ID, AWS_REGION, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME } from "../utils/constants.js";
import logger from "../utils/logger.js";

const s3 = new S3Client({
    region: AWS_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
});

const getISTTimestamp = () => {
    return new Date()
        .toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        .replace(/[/, ]/g, "-")
        .replace(/:/g, "");
};

const upload = multer({
    storage: multerS3({
        s3,
        bucket: S3_BUCKET_NAME,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: (req, file, cb) => {
            const timestamp = getISTTimestamp();

            const safeFileName = file.originalname.replace(/\s+/g, "_").toUpperCase();
            const fileName = `${timestamp}-${safeFileName}`;

            cb(null, fileName);
        },
    }),
    limits: { fileSize: 25 * 1024 * 1024 },
});

export default upload;