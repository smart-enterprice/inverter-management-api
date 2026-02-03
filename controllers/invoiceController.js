// controllers/invoiceController.js

import asyncHandler from "express-async-handler";
import invoiceService from "../service/invoiceService.js";

const invoiceController = {
    getByOrderNumber: asyncHandler(async (req, res) => {
        const { orderNumber } = req.params;

        const invoiceDetails = await invoiceService.getByOrderNumber(orderNumber);

        res.status(200).json({
            success: true,
            data: invoiceDetails
        });
    })
};

export default invoiceController;