// orderRoute.js
import express from 'express';
import { verifyToken } from '../middleware/verifyToken.js';
import orderController from '../controllers/orderController.js';
import { sanitizeInputBody } from '../utils/validationUtils.js';

const router = express.Router();

/* -------------------- Global Middlewares -------------------- */
router.use(verifyToken);
router.use(sanitizeInputBody);

/* -------------------- Create -------------------- */
router.post('/create-order', orderController.createOrder);

/* -------------------- Read -------------------- */
router.get("/", orderController.getAll);
router.get("/date-filter", orderController.fetchOrdersByDateFilter);
router.get("/status/:orderStatus", orderController.getByOrderStatus);
router.get("/:orderId", orderController.getByOrderId);

/* -------------------- Update -------------------- */
router.put("/:orderDetailsId", orderController.updateOrderDetailStatus);
router.put("/order/:orderNumber", orderController.updateMultipleOrderDetailsStatus);
router.put("/status/:orderNumber", orderController.updateOrderStatusUnified);

export default router;