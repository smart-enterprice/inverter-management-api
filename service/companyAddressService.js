import CompanyAddress from "../models/companyAddress.js";
import { v4 as uuidv4 } from "uuid";

const companyAddressService = {

    async createOrUpdate(data) {
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
        return CompanyAddress.find({ is_active: true });
    }
};

export default companyAddressService;