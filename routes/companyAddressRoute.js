import express from "express";
import companyAddressController from "../controllers/companyAddressController";

const router = express.Router();

router.post("/", companyAddressController.upsertCompanyAddress); // create or update
router.get("/", companyAddressController.getCompanyAddress);

export default router;