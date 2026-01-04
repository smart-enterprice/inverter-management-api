import Invoice from "../models/invoice.js";
import OrderDetails from "../models/orderDetails.js";
import { ORDER_STATUSES } from "../utils/constants.js";
import { generateUniqueInvoiceId } from "../utils/generatorIds.js";

const invoiceService = {

    async generateOrUpdateInvoice(order) {
        if (!order || order.status !== ORDER_STATUSES.INVOICE) return null;

        const invoiceDetails = await OrderDetails.find({
            order_number: order.order_number,
            status: ORDER_STATUSES.INVOICE
        });

        if (!invoiceDetails.length) return null;

        let invoice = await Invoice.findOne({ order_number: order.order_number });

        if (!invoice) {
            invoice = new Invoice({
                invoice_id: await generateUniqueInvoiceId(),
                order_number: order.order_number,
                order_items: new Map()
            });
        }

        for (const detail of invoiceDetails) {
            invoice.order_items.set(
                detail.order_details_number,
                detail.qty_ordered
            );
        }

        await invoice.save();
        return invoice;
    },

    async generateOrUpdateInvoiceByOrderDetail(orderDetail, invoiceQuantity = 0) {
        if (!orderDetail || orderDetail.status !== ORDER_STATUSES.INVOICE) return null;
        if (invoiceQuantity < 0) return null;

        let invoice = await Invoice.findOne({
            order_number: orderDetail.order_number
        });

        if (!invoice) {
            invoice = new Invoice({
                invoice_id: await generateUniqueInvoiceId(),
                order_number: orderDetail.order_number,
                order_items: new Map()
            });
        }

        const key = orderDetail.order_details_number;
        const qtyToAdd = invoiceQuantity === 0 ?
            orderDetail.qty_ordered :
            invoiceQuantity;

        const existingQty = invoice.order_items.get(key) || 0;
        invoice.order_items.set(key, existingQty + qtyToAdd);

        await invoice.save();
        return invoice;
    }
};

export default invoiceService;