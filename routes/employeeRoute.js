// employeeRoute.js

import express from "express";
import employeeController from "../controllers/employeeController.js";
import { verifyToken } from "../middleware/verifyToken.js";

const router = express.Router();

// ✅ Global Middlewares
router.use(employeeController.employeeSecurityMiddleware);
router.use(verifyToken);


// ========================== EMPLOYEE ROUTES ==========================


// Signup
// @route POST /api/v1/employees/signup
router.post("/signup", employeeController.signup);

// Profile Management
// @route PUT /api/v1/employees/:employeeId
router.put("/:employeeId", employeeController.updateProfile);

// Reset Passwords
// @route PUT /api/v1/employees/update/reset-password/:employeeId
router.put("/update/reset-password/:employeeId", employeeController.resetPasswordById);

// @route PUT /api/v1/employees/update/reset-password
router.put("/update/reset-password", employeeController.resetPassword);

// Delete Employee
// @route PUT /api/v1/employees/update/delete-employee
router.put("/update/delete-employee", employeeController.deleteEmployee);

// Get Employee By ID
// @route GET /api/v1/employees/:employeeId
router.get("/:employeeId", employeeController.getProfileByEmployeeId);

// Get Logged-in Profile
// @route GET /api/v1/employees/get/profile
router.get("/get/profile", employeeController.getProfile);

// Get All Employees
// @route GET /api/v1/employees
router.get("/", employeeController.getAllEmployees);

// Get Employees With Password (Admin only)
router.get("/get/employees-password", employeeController.getAllEmployeesWithPassword);

// Get Deleted Employees
router.get("/get/deleted-employees", employeeController.getAllDeletedEmployees);

// Get Employees By Role
router.get("/getByRole/:employeeRole", employeeController.getAllProfileByEmployeeRole);


// ========================== DEALER ROUTES ==========================

// Dealer Discount Management
router.post("/dealer/create-discount", employeeController.createDealerDiscount);
router.post("/dealer/create-discounts", employeeController.createDealerDiscountList);
router.post("/dealer/get-discounts", employeeController.getDealerDiscount);
router.put("/dealer/update-discount", employeeController.updateDealerDiscount);

// Dealer Employee Management
router.get("/dealers/get", employeeController.getAllDealerEmployees);
router.get("/dealers/deleted", employeeController.getAllDeletedDealerEmployees);

export default router;
