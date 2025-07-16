// productRoute.js
import express from 'express';
import { verifyToken } from '../middleware/verifyToken.js';
import productController from '../controllers/productController.js';
import { sanitizeInputBody } from '../utils/validationUtils.js';

const router = express.Router();

router.use(verifyToken);
router.use(sanitizeInputBody);

// @route   POST
router.post('/create', productController.createProduct);

// @route   GET
router.get('/', productController.getAll);

router.get('/:productId', productController.getByProductId);

// @route   PUT
router.put('/:productId', productController.updateProduct);

router.put('/createOrUpdate/product-stocks', productController.createOrUpdateProductStocks);

export default router;