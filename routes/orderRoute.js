// orderroute.js
import express from 'express';
import { verifyToken } from '../middleware/verifyToken.js';
import orderController from '../controllers/orderController.js';

const router = express.Router();

router.use(verifyToken);
router.use(orderController.sanitizeInput);

router.post('/create', orderController.createOrder);
router.get('/', orderController.getAll);
router.get('/:orderId', orderController.getByOrderId);
// router.put('/:orderId', orderController.updateProduct);

export default router;