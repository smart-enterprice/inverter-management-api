// controllers/bulkImportController.js
import asyncHandler from "express-async-handler";
import ExcelJS from "exceljs";
import { BadRequestException } from "../middleware/CustomError.js";
import { bulkImportService } from "../service/bulkImportService.js";

const bulkImportController = {

    uploadAndImport: asyncHandler(async (req, res) => {
        if (!req.file) {
            throw new BadRequestException(
                "No file uploaded. Please attach an .xlsx file with field name 'file'."
            );
        }

        const allowedMimeTypes = [
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel",
        ];

        if (!allowedMimeTypes.includes(req.file.mimetype)) {
            throw new BadRequestException(
                "Invalid file type. Only .xlsx / .xls files are accepted."
            );
        }

        const result = await bulkImportService.processExcelFile(
            req.file.buffer,
            req.file.originalname
        );

        return res.status(200).json({
            success: true,
            status: 200,
            message: "✅ Bulk import completed.",
            summary: result.summary,
            details: result.details,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        });
    }),

    getTemplate: asyncHandler(async (req, res) => {
        const isDownload = req.query.download === "true";

        const templateData = {
            sheets: {
                "Delaer Data": {
                    description: "Dealer accounts (ROLE_DEALER is assigned automatically)",
                    columns: [
                        "Name",
                        "Email (optional – auto-generated if blank)",
                        "Phone Number",
                        "Password (optional – auto-generated if blank)",
                        "Shop Name",
                        "Brand (comma-separated for multiple)",
                        "District",
                        "Town",
                        "Address",
                    ],
                },
                "User Data": {
                    description: "Internal users with dynamic roles",
                    columns: [
                        "Name",
                        "Email",
                        "Phone Number",
                        "Password (optional – auto-generated if blank)",
                        "District",
                        "Town",
                        "Address",
                        "Role (e.g. ROLE_SALESMAN)",
                    ],
                },
                "Brand Data": {
                    description: "Product brands",
                    columns: [
                        "Brand Name",
                        "Models (comma-separated)",
                        "Description",
                    ],
                },
            },
            passwordRule:
                "Auto-generated format: {FirstName}-smartinvert@1221  e.g. Ajmal-smartinvert@1221",
        };

        if (!isDownload) {
            return res.status(200).json({
                success: true,
                status: 200,
                message: "📋 Excel template structure",
                data: templateData,
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
            });
        }

        // 🔥 DOWNLOAD MODE (REAL EXCEL FILE)
        const workbook = new ExcelJS.Workbook();
        Object.entries(templateData.sheets).forEach(([sheetName, sheetData]) => {
            const worksheet = workbook.addWorksheet(sheetName);

            // Add header row
            worksheet.addRow(sheetData.columns);

            // Style header (optional but pro)
            worksheet.getRow(1).font = { bold: true };
        });

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            "attachment; filename=file_upload_template.xlsx"
        );

        await workbook.xlsx.write(res);
        res.end();
    }),
};

export default bulkImportController;