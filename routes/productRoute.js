// productRoute.js
import express from 'express';
import { verifyToken } from '../middleware/verifyToken.js';
import productController from '../controllers/productController.js';
import { sanitizeInputBody } from '../utils/validationUtils.js';

const router = express.Router();

router.use(verifyToken);
router.use(sanitizeInputBody);

// PRODUCT ROUTES
// @route   POST
router.post('/create-product', productController.createProduct);
router.post('/getAllProductsByBrand', productController.getAllProductsByBrands);

// @route   GET
router.get('/', productController.getAllActiveProducts);
router.get('/get/all', productController.getAll);
router.get('/:productId', productController.getByProductId);

// @route   PUT
router.put('/:productId', productController.updateProduct);
router.put('/createOrUpdate/product-stocks', productController.createOrUpdateProductStocks);

// BRAND ROUTES
// @route   POST
router.post('/create/brands', productController.createProductBrands);

// @route   GET
router.get('/getAll/brands', productController.getAllBrands);
router.get('/getActive/brands', productController.getActiveBrands);
router.get('/product-brand/:brandId', productController.getByBrandId);

// @route   PUT
router.put('/brand/:brandName', productController.statusChangeByBrandName);


export default router;