// authRoute.js

import express from 'express';
import authController from '../controllers/authController.js';

const router = express.Router();

// @route   POST
// @openapi
router.route('/signin').post(authController.signin);

router.route('/logout').post(authController.logout);

// routes/authRoutes.js
router.get("/token/active", authController.checkTokenActive);

export default router;