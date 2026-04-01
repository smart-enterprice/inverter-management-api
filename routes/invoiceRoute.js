// invoiceRoute.js
import express from 'express';
import { verifyToken } from '../middleware/verifyToken.js';
import { sanitizeInputBody } from '../utils/validationUtils.js';
import invoiceController from '../controllers/invoiceController.js';

const router = express.Router();

/* -------------------- Global Middlewares -------------------- */
router.use(verifyToken);
router.use(sanitizeInputBody);

router.get("/:orderNumber", invoiceController.getByOrderNumber);

export default router;