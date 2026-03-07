// employeeRoute.js

import express from "express";
import employeeController from "../controllers/employeeController.js";
import { verifyToken } from "../middleware/verifyToken.js";

const router = express.Router();

// ✅ Global Middlewares
router.use(employeeController.employeeSecurityMiddleware);
router.use(verifyToken);

// ========================== EMPLOYEE ROUTES ==========================
router.post("/signup", employeeController.signup);
router.put("/:employeeId", employeeController.updateProfile);
router.put("/update/reset-password/:employeeId", employeeController.resetPasswordById);
router.put("/update/reset-password", employeeController.resetPassword);
router.put("/update/delete-employee", employeeController.deleteEmployee);

router.get("/get/profile", employeeController.getProfile);
router.get("/count", employeeController.getEmployeeCounts);
router.get("/get/employees-password", employeeController.getAllEmployeesWithPassword);
router.get("/get/deleted-employees", employeeController.getAllDeletedEmployees);
router.get("/getByRole/:employeeRole", employeeController.getAllProfileByEmployeeRole);
router.get("/:employeeId", employeeController.getProfileByEmployeeId);
router.get("/", employeeController.getAllEmployees);

// ========================== DEALER ROUTES ==========================
router.post("/dealer/create-discount", employeeController.createDealerDiscount);
router.post("/dealer/create-discounts", employeeController.createDealerDiscountList);

router.post("/dealer/get-discounts", employeeController.getDealerDiscounts);
router.put("/dealer/update-discount", employeeController.updateDealerDiscount);

router.get("/dealers/get", employeeController.getAllDealerEmployees);
router.get("/dealers/deleted", employeeController.getAllDeletedDealerEmployees);

export default router;