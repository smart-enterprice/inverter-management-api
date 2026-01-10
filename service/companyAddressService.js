import CompanyAddress from "../models/companyAddress.js";
import { isRoleAllowedForApproval } from "../utils/validationUtils.js";

const companyAddressService = {

    async createOrUpdate(data) {
        if (!isRoleAllowedForApproval(userRole)) {
            throw new Error("Unauthorized role to create or update company address");
        }

        const existing = await CompanyAddress.findOne({ is_active: true });

        // 🟢 CREATE
        if (!existing) {
            return CompanyAddress.create({
                ...data,
                company_address_id: `CA-${uuidv4()}`
            });
        }

        // 🔵 UPDATE (MERGE)
        Object.keys(data).forEach(key => {
            if (data[key] !== undefined) {
                existing[key] = data[key];
            }
        });

        return existing.save();
    },

    async getActive() {
        return CompanyAddress.findOne({ is_active: true }).lean();
    }
};

export default companyAddressService;