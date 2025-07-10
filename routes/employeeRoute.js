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

router.get('/get/profile', employeeController.getProfile);

router.put('/update/reset-password', employeeController.resetPassword);

router.put('/delete-employee/:employeeId', employeeController.deleteEmployee);

// @route   GET /api/employees
router.get('/', employeeController.getAllEmployees);

router.get('/get/deleted-employees', employeeController.getAllDeletedEmployees);

export default router;