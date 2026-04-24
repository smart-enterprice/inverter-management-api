import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import companyAddressController from "../controllers/companyAddressController.js";

const router = express.Router();

router.use(verifyToken);

router.post("/", companyAddressController.upsertCompanyAddress); // create or update
router.get("/", companyAddressController.getCompanyAddress);

export default router;