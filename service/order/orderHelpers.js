import Employee from "../../models/employees.js";
import OrderDetails from "../../models/orderDetails.js";
import { ROLES } from "../../utils/constants.js";

export const fetchDealerAndOrderDetails = async (orders = []) => {
    if (!Array.isArray(orders) || orders.length === 0) {
        return { dealerMap: {}, detailsMap: {} };
    }

    const dealerIds = [...new Set(orders.map(o => o.dealer_id))];
    const orderNumbers = orders.map(o => o.order_number);

    const [dealers, orderDetails] = await Promise.all([
        Employee.find({
            employee_id: { $in: dealerIds },
            role: ROLES.DEALER
        }),
        OrderDetails.find({
            order_number: { $in: orderNumbers }
        })
    ]);

    const dealerMap = dealers.reduce((map, dealer) => {
        map[dealer.employee_id] = dealer;
        return map;
    }, {});

    const detailsMap = orderDetails.reduce((map, detail) => {
        if (!map[detail.order_number]) {
            map[detail.order_number] = [];
        }
        map[detail.order_number].push(detail);
        return map;
    }, {});

    return { dealerMap, detailsMap };
};

export const toNumberSafe = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const appendOrderNote = (orderDetail, note) => {
    orderDetail.notes = [orderDetail.notes, note].filter(Boolean).join(" | ");
};

export const recalculateOrderDetailPricing = (detail) => {
    const unitPrice = toNumberSafe(detail.unit_product_price);
    const unitDiscount = toNumberSafe(detail.dealer_discount);

    detail.total_product_price = unitPrice * detail.qty_ordered;
    detail.total_dealer_discount = unitDiscount * detail.qty_ordered;
    detail.total_price = detail.total_product_price - detail.total_dealer_discount;
};