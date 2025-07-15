// authroute.js

import express from 'express';
import authController from '../controllers/authController.js';

const router = express.Router();

// @route   POST
router.route('/signin').post(authController.signin);

router.route('/logout').post(authController.logout);

export default router;