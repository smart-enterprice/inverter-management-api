// service/bulkImportService.js
import xlsx from "xlsx";
import validator from "validator";

import employeeSchema from "../models/employees.js";
import Brand from "../models/brand.js";
import { generateUniqueBrandId, generateUniqueEmployeeId } from "../utils/generatorIds.js";
import { hashPassword } from "../utils/employeeAuth.js";
import { mapProductBrandEntityToResponse } from "../utils/modelMapper.js";
import { CurrentRequestContext } from "../utils/CurrentRequestContext.js";
import logger from "../utils/logger.js";
import { ROLES } from "../utils/constants.js";
import { BadRequestException } from "../middleware/CustomError.js";
import { generatePassword, generateUniqueEmail } from "../utils/generateData.js";
import { getBrandsFromRow, getModelsFromRow, mergeUniqueModels, normalizeModels, normalizeToUpper } from "../utils/brandUtils.js";

//  Helpers

const toStr = (val) =>
    val === null || val === undefined ? "" : String(val).trim();

const toUpperArray = (val) =>
    [...new Set(
        toStr(val)
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
    )];

const parseSheet = (workbook, sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];

    const rows = xlsx.utils.sheet_to_json(sheet, {
        defval: "",
        raw: false,
        blankrows: false,
    });

    return rows.filter((row) =>
        Object.values(row).some((v) => toStr(v).length > 0)
    );
};

//  Validation helpers

const ALLOWED_ROLES = new Set(Object.values(ROLES));

const validateEmployeeRow = (row, index, sheetLabel) => {
    const errors = [];

    const name = toStr(row["Name"]);
    const email = toStr(row["Email"]) || toStr(row["Email Address"]) || toStr(row["Email (optional – auto-generated if blank)"]) || generateUniqueEmail(name);
    const phone = toStr(row["Phone Number"]);

    if (!name || name.length < 2)
        errors.push(`Row ${index}: Name is required (min 2 chars)`);

    if (!email || !validator.isEmail(email))
        errors.push(`Row ${index}: Valid email is required`);

    if (!phone || !validator.isMobilePhone(phone, "any", { strictMode: false }))
        errors.push(`Row ${index}: Valid phone number is required`);

    return errors;
};

const validateBrandRow = (row, index) => {
    const errors = [];

    const brandName = toStr(row["Brand Name"]);
    if (!brandName)
        errors.push(`Row ${index}: Brand Name is required`);

    const models = getModelsFromRow(row);
    if (models.length === 0)
        errors.push(`Row ${index}: At least one model is required`);

    return errors;
};

//  Per-entity creators

const createEmployee = async ({
    name,
    email,
    phone,
    password,
    role,
    shopName,
    brands,
    district,
    town,
    address,
    createdBy,
}) => {
    const [emailExists, phoneExists] = await Promise.all([
        employeeSchema.findOne({ employee_email: email.toLowerCase() }),
        employeeSchema.findOne({ employee_phone: Number(phone) }),
    ]);

    if (emailExists) throw new BadRequestException(`Email already registered: ${email}`);
    if (phoneExists) throw new BadRequestException(`Phone already registered: ${phone}`);

    const employeeId = await generateUniqueEmployeeId();
    const hashedPwd = await hashPassword(password);

    // Validate brands exist in DB (for dealers)
    let resolvedBrands = [];
    if (brands && brands.length > 0) {
        const upperBrands = brands.map((b) => b.toUpperCase());
        const brandDocs = await Brand.find({
            brand_name: { $in: upperBrands },
            status: "active",
        });

        resolvedBrands = brandDocs.map((b) => b.brand_name);
    }

    const employee = new employeeSchema({
        employee_id: employeeId,
        employee_name: name,
        employee_email: email.toLowerCase(),
        employee_phone: Number(phone),
        password: hashedPwd,
        role: role.toUpperCase(),
        status: "active",
        shop_name: shopName || undefined,
        brand: resolvedBrands.length > 0 ? resolvedBrands : undefined,
        district: district || undefined,
        town: town || undefined,
        address: address || undefined,
        created_by: createdBy,
    });

    await employee.save();

    return {
        employee_id: employeeId,
        employee_name: name,
        employee_email: email,
        role,
    };
};

const createBrand = async ({ brandName, models, description, createdBy }) => {
    const normalizedBrandName = normalizeToUpper(brandName);
    const normalizedModels = normalizeModels(models);

    // 🔍 Fetch only required fields (lean for performance)
    const existingBrand = await Brand.findOne(
        { brand_name: normalizedBrandName },
        { brand_models: 1 }
    ).lean();

    if (existingBrand) {
        const mergedModels = mergeUniqueModels(
            existingBrand.brand_models,
            normalizedModels
        );

        const isSame =
            mergedModels.length === existingBrand.brand_models.length &&
            mergedModels.every((m, i) => m === existingBrand.brand_models[i]);

        if (isSame) {
            return mapProductBrandEntityToResponse(existingBrand);
        }

        const updatedBrand = await Brand.findOneAndUpdate(
            { brand_name: normalizedBrandName },
            { $set: { brand_models: mergedModels } },
            { new: true }
        );

        return mapProductBrandEntityToResponse(updatedBrand);
    }

    const brandId = await generateUniqueBrandId();

    const newBrand = await Brand.create({
        brand_id: brandId,
        brand_name: normalizedBrandName,
        brand_models: normalizedModels,
        description: description?.trim() || "",
        created_by: createdBy,
        status: "active",
    });

    return mapProductBrandEntityToResponse(newBrand);
};

const processDealerSheet = async (rows, createdBy) => {
    const succeeded = [];
    const failed = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // +2: header row + 0-index

        // Validate
        const errors = validateEmployeeRow(row, rowNum, "Dealer");
        if (errors.length > 0) {
            failed.push({ row: rowNum, errors });
            continue;
        }

        const name = toStr(row["Name"]);
        const email = toStr(row["Email"]) || toStr(row["Email Address"]) || toStr(row["Email (optional – auto-generated if blank)"]) || generateUniqueEmail(name);
        const phone = toStr(row["Phone Number"]);
        const password = generatePassword(name);
        const shopName = toStr(row["Shop Name"]);
        const brands = getBrandsFromRow(row);
        const district = toStr(row["District"]);
        const town = toStr(row["Town"]);
        const address = toStr(row["Address"]);

        try {
            const result = await createEmployee({
                name,
                email,
                phone,
                password,
                role: ROLES.DEALER,
                shopName,
                brands,
                district,
                town,
                address,
                createdBy,
            });

            succeeded.push({
                row: rowNum,
                employee_id: result.employee_id,
                employee_name: result.employee_name,
                employee_email: result.employee_email,
                role: result.role,
                password_used: password,
            });
        } catch (err) {
            logger.error(`[BulkImport] Dealer row ${rowNum} failed: ${err.message}`);
            failed.push({ row: rowNum, errors: [err.message] });
        }
    }

    return { succeeded, failed };
};

const processUserSheet = async (rows, createdBy) => {
    const succeeded = [];
    const failed = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        const errors = validateEmployeeRow(row, rowNum, "User");
        if (errors.length > 0) {
            failed.push({ row: rowNum, errors });
            continue;
        }

        const role = toStr(row["Role"]).toUpperCase();
        if (!ALLOWED_ROLES.has(role)) {
            failed.push({
                row: rowNum,
                errors: [`Invalid role '${role}'. Allowed: ${[...ALLOWED_ROLES].join(", ")}`],
            });
            continue;
        }

        const name = toStr(row["Name"]);
        const email = toStr(row["Email"]) || toStr(row["Email Address"]) || toStr(row["Email (optional – auto-generated if blank)"]) || generateUniqueEmail(name);
        const phone = toStr(row["Phone Number"]);
        const password = generatePassword(name);
        const district = toStr(row["District"]);
        const town = toStr(row["Town"]);
        const address = toStr(row["Address"]);

        try {
            const result = await createEmployee({
                name,
                email,
                phone,
                password,
                role,
                district,
                town,
                address,
                createdBy,
            });

            succeeded.push({
                row: rowNum,
                employee_id: result.employee_id,
                employee_name: result.employee_name,
                employee_email: result.employee_email,
                role: result.role,
                password_used: password,
            });
        } catch (err) {
            logger.error(`[BulkImport] User row ${rowNum} failed: ${err.message}`);
            failed.push({ row: rowNum, errors: [err.message] });
        }
    }

    return { succeeded, failed };
};

const processBrandSheet = async (rows, createdBy) => {
    const succeeded = [];
    const failed = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        const errors = validateBrandRow(row, rowNum);
        if (errors.length > 0) {
            failed.push({ row: rowNum, errors });
            continue;
        }

        const brandName = toStr(row["Brand Name"]);
        const models = getModelsFromRow(row);
        const description = toStr(row["Description"]);

        try {
            const result = await createBrand({
                brandName,
                models,
                description,
                createdBy,
            });

            succeeded.push({
                row: rowNum,
                brand_id: result.brand_id,
                brand_name: result.brand_name,
                models: result.brand_models,
            });
        } catch (err) {
            logger.error(`[BulkImport] Brand row ${rowNum} failed: ${err.message}`);
            failed.push({ row: rowNum, errors: [err.message] });
        }
    }

    return { succeeded, failed };
};

export const bulkImportService = {
    processExcelFile: async (buffer, filename = "upload.xlsx") => {
        logger.info(`[BulkImport] Processing file: ${filename}`);

        const workbook = xlsx.read(buffer, { type: "buffer", cellDates: false });

        const createdBy = CurrentRequestContext.getEmployeeId() || "SYSTEM";

        // ── Sheet names ──
        const DEALER_SHEET = "Delaer Data";   // Note: intentional typo matching the actual file
        const USER_SHEET = "User Data";
        const BRAND_SHEET = "Brand Data";

        const missingSheets = [DEALER_SHEET, USER_SHEET, BRAND_SHEET].filter(
            (s) => !workbook.SheetNames.includes(s)
        );

        if (missingSheets.length === 3) {
            throw new Error(
                `No recognised sheets found. Expected at least one of: "${DEALER_SHEET}", "${USER_SHEET}", "${BRAND_SHEET}"`
            );
        }

        // ── Parse sheets ──
        const brandRows = parseSheet(workbook, BRAND_SHEET);
        const userRows = parseSheet(workbook, USER_SHEET);
        const dealerRows = parseSheet(workbook, DEALER_SHEET);

        logger.info(
            `[BulkImport] Rows → Dealers:${dealerRows.length} | Users:${userRows.length} | Brands:${brandRows.length}`
        );

        // ── Process (brands first so dealer brand validation works) ──
        const brandResult = await processBrandSheet(brandRows, createdBy);
        const userResult = await processUserSheet(userRows, createdBy);
        const dealerResult = await processDealerSheet(dealerRows, createdBy);

        const summary = {
            dealers: {
                total: dealerRows.length,
                created: dealerResult.succeeded.length,
                failed: dealerResult.failed.length,
            },
            users: {
                total: userRows.length,
                created: userResult.succeeded.length,
                failed: userResult.failed.length,
            },
            brands: {
                total: brandRows.length,
                created: brandResult.succeeded.length,
                failed: brandResult.failed.length,
            },
        };

        const details = {
            dealers: dealerResult,
            users: userResult,
            brands: brandResult,
        };

        logger.info(`[BulkImport] Done. Summary: ${JSON.stringify(summary)}`);

        return { summary, details };
    },
};