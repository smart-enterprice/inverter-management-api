// productRoute.js
import express from 'express';
import { verifyToken } from '../middleware/verifyToken.js';
import productController from '../controllers/productController.js';
import { sanitizeInputBody } from '../utils/validationUtils.js';

const router = express.Router();

router.use(verifyToken);
router.use(sanitizeInputBody);

// PRODUCT ROUTES
// CREATE
router.post("/create-product", productController.createProduct);
router.post("/getAllProductsByBrand", productController.getAllProductsByBrands);

// READ
router.get("/", productController.getAllActiveProducts);
router.get("/get/all", productController.getAll);
router.get("/low-stock", productController.getLowStockProducts); // ✅ Low Stock API
router.get("/:productId", productController.getByProductId);

// UPDATE
router.put("/:productId", productController.updateProduct);
router.put("/createOrUpdate/product-stocks", productController.createOrUpdateProductStocks);

// BRAND ROUTES
// CREATE
router.post("/create/brands", productController.createProductBrands);

// READ
router.get("/getAll/brands", productController.getAllBrands);
router.get("/product-brand/:brandId", productController.getByBrandId);

// UPDATE
router.put("/brand/:brandName", productController.statusChangeByBrandName);

export default router;