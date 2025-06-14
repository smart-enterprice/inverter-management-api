// productRoute.js
import express from 'express';
import { verifyToken } from '../middleware/verifyToken.js';
import productController from '../controllers/productController.js';

const router = express.Router();

router.use(verifyToken);
router.use(productController.sanitizeInput);

router.post('/create', productController.createProduct);
router.get('/', productController.getAll);
router.get('/:productId', productController.getByProductId);
router.put('/:productId', productController.updateProduct);

export default router;