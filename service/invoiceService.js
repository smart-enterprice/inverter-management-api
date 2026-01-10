import Invoice from "../models/invoice.js";
import OrderDetails from "../models/orderDetails.js";
import { ORDER_STATUSES } from "../utils/constants.js";
import { generateUniqueInvoiceId } from "../utils/generatorIds.js";

const createInvoiceInstance = async(orderNumber) => {
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
    }
};

export default invoiceService;