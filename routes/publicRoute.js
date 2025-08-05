// employeeroute.js

import express from 'express';
import { verifyToken } from '../middleware/verifyToken.js';
import publicController from '../controllers/publicController.js';

const router = express.Router();

router.use(verifyToken);

// @route   POST /api/employees/signup
router.get('/search/:searchContent', publicController.search);

export default router;