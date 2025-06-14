// employeeroute.js

import express from 'express';
import employeeController from '../controllers/employeeController.js';
import { verifyToken } from '../middleware/verifyToken.js';

const router = express.Router();

router.use(employeeController.employeeSecurityMiddleware);
router.use(verifyToken);

// @route   POST /api/employees/signup
router.post('/signup', employeeController.signup);

// @route   GET /api/employees/:employeeId
router.get('/:employeeId', employeeController.getProfileByEmployeeId);

// @route   PUT /api/employees/:employeeId
router.put('/:employeeId', employeeController.updateProfile);

router.get('/profile', employeeController.getProfile);

// @route   GET /api/employees
router.get('/', employeeController.getAllEmployees);

export default router;