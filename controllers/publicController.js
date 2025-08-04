// employeeController.js
import asyncHandler from "express-async-handler";

import { BadRequestException } from "../middleware/CustomError.js";
import { sanitizeInputBody } from "../utils/validationUtils.js";

import employeeSchema from "../models/employees.js";
import Product from "../models/product.js";
import Brand from "../models/brand.js";
import Order from "../models/order.js";

import { mapEmployeeEntityToResponse, mapProductBrandEntityToResponse, mapProductEntityToResponse, mapStockEntityToResponse, transformOrderToResponse } from "../utils/modelMapper.js";
import { fetchDealerAndOrderDetails } from "../service/orderService.js";
import Stock from "../models/stock.js";
import OrderDetails from "../models/orderDetails.js";

const getPaginationParams = (query) => {
    const page = parseInt(query.page || "1", 10);
    const limit = parseInt(query.limit || "10", 10);
    const skip = (page - 1) * limit;
    return { page, limit, skip };
};

const publicController = {
    sanitizeInputBody,

    search: [
        sanitizeInputBody,
        asyncHandler(async(req, res) => {
            const { searchContent } = req.params;
            if (!searchContent || !searchContent.trim()) {
                throw new BadRequestException("Search content is missing or invalid.");
            }

            const keyword = searchContent.trim();
            const regex = new RegExp(keyword, 'i');

            const phoneSearch = Number(keyword);
            const phoneCondition = isNaN(phoneSearch) ? {} : { employee_phone: phoneSearch };

            const employees = await employeeSchema.find({
                $or: [
                    { employee_name: regex },
                    { employee_id: regex },
                    { employee_email: regex },
                    phoneCondition
                ],
                status: 'active'
            }).select('-password').sort({ created_at: -1 });

            const employeesData = (employees || []).map(mapEmployeeEntityToResponse);

            const products = await Product.find({
                $or: [
                    { product_name: regex },
                    { product_id: regex }
                ]
            }).sort({ created_at: -1 });

            const productData = [];
            for (const product of products || []) {
                const stocks = await Stock.find({ product_id: product.product_id });
                productData.push(
                    mapProductEntityToResponse(
                        product,
                        (stocks || []).map(mapStockEntityToResponse)
                    )
                );
            }

            const brands = await Brand.find({
                $or: [
                    { brand_name: regex },
                    { brand_id: regex }
                ]
            }).sort({ created_at: -1 });

            const brandData = (brands || []).map(mapProductBrandEntityToResponse);

            const orderDetails = await OrderDetails.find({
                $or: [
                    { product_name: regex },
                    { order_number: regex }
                ]
            });

            const relatedOrderNumbers = [...new Set((orderDetails || []).map(d => d.order_number))];

            const orders = await Order.find({
                $or: [
                    { order_number: regex },
                    { status: regex },
                    { order_number: { $in: relatedOrderNumbers } }
                ]
            }).sort({ created_at: -1 });

            const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);

            const ordersData = (orders || []).map(order =>
                transformOrderToResponse(
                    order,
                    dealerMap[order.dealer_id],
                    detailsMap[order.order_number] || []
                )
            );

            const responseData = {
                employeesData,
                productData,
                brandData,
                ordersData
            };

            return res.status(200).json({
                success: true,
                status: 200,
                message: `🔍 Search results for ${keyword}`,
                data: responseData,
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
            });
        })
    ],
};

export default publicController;