import { ForbiddenException } from "../middleware/CustomError.js";
import companyAddressService from "../service/companyAddressService.js";
import { getAuthenticatedEmployeeContext, isRoleAllowedForApproval } from "../utils/validationUtils.js";

const companyAddressController = {

    async upsertCompanyAddress(req, res, next) {
        try {
            const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
            console.log(employeeId, employeeRole);

            if (!isRoleAllowedForApproval(employeeRole)) {
                throw new ForbiddenException(
                    "Access denied. You are not authorized to create or update company address details. Please contact the system administrator."
                );
            }

            const result = await companyAddressService.createOrUpdate(req.body);

            res.status(200).json({
                success: true,
                message: "Company address saved successfully",
                data: result
            });
        } catch (error) {
            next(error);
        }
    },

    async getCompanyAddress(req, res, next) {
        try {
            const result = await companyAddressService.getActive();
            res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }
};

export default companyAddressController;