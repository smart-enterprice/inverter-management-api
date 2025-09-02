// orderroute.js
import express from 'express';
import { verifyToken } from '../middleware/verifyToken.js';
import orderController from '../controllers/orderController.js';
import { sanitizeInputBody } from '../utils/validationUtils.js';

const router = express.Router();

router.use(verifyToken);
router.use(sanitizeInputBody);

// @route   POST
router.post('/create', orderController.createOrder);

// @route   GET
router.get('/', orderController.getAll);
router.get('/date-filter', orderController.fetchOrdersByDateFilter);
router.get('/:orderId', orderController.getByOrderId);
router.get('/status/:orderStatus', orderController.getByOrderStatus);

// @route   PUT
router.put('/:orderDetailsId', orderController.updateOrderDetailStatus);
router.put('/order/:orderNumber', orderController.updateMultipleOrderDetailsStatus);

// router.put('/:orderId', orderController.updateProduct);

export default router;