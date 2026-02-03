import { BadRequestException } from "../middleware/CustomError.js";
import Invoice from "../models/invoice.js";
import OrderDetails from "../models/orderDetails.js";
import { ORDER_STATUSES } from "../utils/constants.js";
import { generateUniqueInvoiceId } from "../utils/generatorIds.js";
import { orderService } from "./order/orderService.js";

const createInvoiceInstance = async (orderNumber) => {
    return new Invoice({
        invoice_id: await generateUniqueInvoiceId(),
        order_number: orderNumber,
        order_items: new Map()
    });
};

const invoiceService = {

    async generateOrUpdateInvoice(order) {
        if (!order || order.status !== ORDER_STATUSES.INVOICE) return null;

        const orderDetails = await OrderDetails.find({
            order_number: order.order_number,
            status: ORDER_STATUSES.INVOICE
        }).lean();

        if (!orderDetails.length) return null;

        let invoice = await Invoice.findOne({ order_number: order.order_number });
        if (!invoice) {
            invoice = await createInvoiceInstance(order.order_number);
        }

        for (const detail of orderDetails) {
            const existingQty = invoice.order_items.get(detail.order_details_number) || 0;
            invoice.order_items.set(
                detail.order_details_number,
                existingQty + detail.qty_ordered
            );
        }

        await invoice.save();
        return invoice;
    },

    async generateOrUpdateInvoiceByOrderDetail(orderDetail, invoiceQty = null) {
        if (!orderDetail || orderDetail.status !== ORDER_STATUSES.INVOICE) return null;

        let invoice = await Invoice.findOne({ order_number: orderDetail.order_number });
        if (!invoice) {
            invoice = await createInvoiceInstance(orderDetail.order_number);
        }

        const key = orderDetail.order_details_number;
        const qtyToAdd = invoiceQty !== null && invoiceQty !== undefined ?
            invoiceQty : orderDetail.qty_ordered;

        if (qtyToAdd < 0) return null;

        const existingQty = invoice.order_items.get(key) || 0;
        invoice.order_items.set(key, existingQty + qtyToAdd);

        await invoice.save();
        return invoice;
    },

    async getByOrderNumber(orderNumber) {
        if (!orderNumber) {
            throw new BadRequestException("Order number is required");
        }

        console.info(`[InvoiceService] Fetching invoice for order: ${orderNumber}`);

        // 1. Fetch invoice
        const invoice = await Invoice.findOne({ order_number: orderNumber }, { _id: 0, __v: 0 }).lean();
        if (!invoice) {
            throw new BadRequestException("Invoice not found");
        }

        // 2. Fetch full order details (order + dealer + order_details)
        const order = await orderService.getByOrderId(orderNumber);

        // 3. Merge invoice item counts into order_details
        const invoiceItemsMap = invoice.order_items || {};
        const orderDetailsWithInvoiceQty = order.order_details.map(detail => {
            const invoiceQty = Number(invoiceItemsMap[detail.order_details_number] || 0);

            // include only invoice-related qty & price calculations
            return {
                ...detail,
                invoice_qty: invoiceQty,
                invoice_total_price: invoiceQty * detail.unit_product_price
            };
        });

        // OPTIONAL: only items with invoice_qty > 0
        const filteredOrderDetails = orderDetailsWithInvoiceQty.filter(
            d => d.invoice_qty > 0
        );

        return {
            invoice: {
                invoice_id: invoice.invoice_id,
                order_number: invoice.order_number,
                total_items: invoice.total_items,
                order_items: invoice.order_items,
                created_at: invoice.created_at,
                order: {
                    ...order,
                    order_details: filteredOrderDetails // or orderDetailsWithInvoiceQty
                }
            }
        };
    }
};

export default invoiceService;