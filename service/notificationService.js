// service/notificationService.js
import { v4 as uuidv4 } from "uuid";
import Notification from "../models/notification.js";
import logger from "../utils/logger.js";

const sseClients = new Map();

// registerSSEClient is used to register an SSE connection for a specific employee.
export const registerSSEClient = (employeeId, role, res) => {
    const existing = sseClients.get(employeeId);
    if (existing) {
        try {
            existing.res.end();
        } catch (_) {
            // already closed
        }
    }

    sseClients.set(employeeId, { res, role, connectedAt: new Date() });
    logger.info(`[SSE] Client connected: ${employeeId} (${role}) | Total: ${sseClients.size}`);
};

// removeSSEClient is used to remove an SSE connection for a specific employee.
export const removeSSEClient = (employeeId) => {
    sseClients.delete(employeeId);
    logger.info(`[SSE] Client disconnected: ${employeeId} | Total: ${sseClients.size}`);
};

// sendToClient is used to send an SSE event to a single client.
const sendToClient = (employeeId, eventName, data) => {
    const client = sseClients.get(employeeId);
    if (!client) return false;

    try {
        client.res.write(`event: ${eventName}\n`);
        client.res.write(`data: ${JSON.stringify(data)}\n\n`);
        return true;
    } catch (err) {
        logger.error(`[SSE] Failed to send to ${employeeId}:`, err.message);
        removeSSEClient(employeeId);
        return false;
    }
};

// broadcastToRoles is used to broadcast an event to all clients whose role is in targetRoles.
const broadcastToRoles = (targetRoles, eventName, data) => {
    let reached = 0;
    const deadClients = [];

    for (const [employeeId, client] of sseClients.entries()) {
        const shouldReceive =
            targetRoles.length === 0 || targetRoles.includes(client.role);

        if (!shouldReceive) continue;

        try {
            client.res.write(`event: ${eventName}\n`);
            client.res.write(`data: ${JSON.stringify(data)}\n\n`);
            reached++;
        } catch (err) {
            logger.error(`[SSE] Dead client detected: ${employeeId}`);
            deadClients.push(employeeId);
        }
    }

    deadClients.forEach(removeSSEClient);
    return reached;
};

// ORDER_NOTIFICATION_ROLES is used to specify the roles that receive ORDER_CREATED notifications.
const ORDER_NOTIFICATION_ROLES = [
    "ROLE_SUPER_ADMIN",
    "ROLE_ADMIN",
    "ROLE_MANAGER",
    "ROLE_PRODUCTION",
    "ROLE_PACKING",
    "ROLE_ACCOUNTS",
    "ROLE_DELIVERY",
];

// notifyOrderCreated is used to notify the relevant clients about the new order.
export const notifyOrderCreated = async ({ order, dealer, createdBy }) => {
    try {
        const notificationId = `NOTIF-${uuidv4().split("-")[0].toUpperCase()}`;

        const dealerName = dealer?.employee_name || "Unknown Dealer";
        const shopName = dealer?.shop_name ? ` (${dealer.shop_name})` : "";

        const notification = await Notification.create({
            notification_id: notificationId,
            type: "ORDER_CREATED",
            title: "New Order Received",
            message: `Order #${order.order_number} placed by ${dealerName}${shopName}`,
            payload: {
                order_number: order.order_number,
                dealer_id: order.dealer_id,
                dealer_name: dealerName,
                shop_name: dealer?.shop_name || "",
                priority: order.priority,
                order_total_price: order.order_total_price,
                item_count: order.order_details?.length || 0,
                created_at: order.created_at,
            },
            target_roles: ORDER_NOTIFICATION_ROLES,
            created_by: createdBy,
        });

        // Build SSE payload
        const ssePayload = {
            notification_id: notification.notification_id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            payload: notification.payload,
            created_at: notification.created_at,
        };

        const reached = broadcastToRoles(
            ORDER_NOTIFICATION_ROLES,
            "ORDER_CREATED",
            ssePayload
        );

        logger.info(
            `[Notification] Order ${order.order_number} → ${reached} client(s) notified`
        );

        return notification;
    } catch (err) {
        logger.error("[Notification] Failed to create/broadcast notification:", err);
        return null;
    }
};

export const getNotificationsForEmployee = async (employeeId, role, page = 1, limit = 20) => {
    const skip = (page - 1) * limit;

    const filter = {
        $or: [
            { target_roles: { $size: 0 } },
            { target_roles: role },
        ],
    };

    const [notifications, total] = await Promise.all([
        Notification.find(filter)
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Notification.countDocuments(filter),
    ]);

    // Attach read status for this specific employee
    const enriched = notifications.map((n) => ({
        ...n,
        is_read: n.read_by.some((r) => r.employee_id === employeeId),
    }));

    return { notifications: enriched, total, page, limit };
};

export const getUnreadCount = async (employeeId, role) => {
    const total = await Notification.countDocuments({
        $or: [{ target_roles: { $size: 0 } }, { target_roles: role }],
        "read_by.employee_id": { $ne: employeeId },
    });
    return total;
};

export const markAsRead = async (notificationId, employeeId) => {
    return Notification.findOneAndUpdate(
        {
            notification_id: notificationId,
            "read_by.employee_id": { $ne: employeeId }, // prevent duplicate
        },
        {
            $push: {
                read_by: { employee_id: employeeId, read_at: new Date() },
            },
        },
        { new: true }
    );
};

export const markAllAsRead = async (employeeId, role) => {
    const filter = {
        $or: [{ target_roles: { $size: 0 } }, { target_roles: role }],
        "read_by.employee_id": { $ne: employeeId },
    };

    const unread = await Notification.find(filter, { notification_id: 1 }).lean();

    await Notification.updateMany(filter, {
        $push: {
            read_by: { employee_id: employeeId, read_at: new Date() },
        },
    });

    return unread.length;
};

export const getConnectedClientCount = () => sseClients.size;