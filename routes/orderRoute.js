// orderroute.js
import express from 'express';
import { verifyToken } from '../middleware/verifyToken.js';

const router = express.Router();

router.use(verifyToken);
// // router.route('/signin').post(authController.signin);
// // router.route('/logout').post(authController.logout);

export default router;