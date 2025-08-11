// employeeroute.js

import express from 'express';
import employeeController from '../controllers/employeeController.js';
import { verifyToken } from '../middleware/verifyToken.js';

const router = express.Router();

router.use(employeeController.employeeSecurityMiddleware);
router.use(verifyToken);

// @route   POST /api/employees/signup
router.post('/signup', employeeController.signup);
router.post('/create/dealer-discount', employeeController.createDealerDiscount);
router.post('/create/dealer-discounts', employeeController.createDealerDiscountList);
router.post('/get/dealer-discounts', employeeController.getDealerDiscount);

// @route   PUT /api/employees/:employeeId
router.put('/:employeeId', employeeController.updateProfile);
router.put('/update/reset-password/:employeeId', employeeController.resetPasswordById);
router.put('/update/reset-password', employeeController.resetPassword);
router.put('/update/delete-employee', employeeController.deleteEmployee);

// @route   GET /api/employees
router.get('/:employeeId', employeeController.getProfileByEmployeeId);
router.get('/get/profile', employeeController.getProfile);
router.get('/', employeeController.getAllEmployees);
router.get('/get/employees-password', employeeController.getAllEmployeesWithPassword);
router.get('/get/deleted-employees', employeeController.getAllDeletedEmployees);

export default router;