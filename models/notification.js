// models/notification.js
import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    return new Date(date.getTime() + 330 * 60000);
}

const notificationSchema = new mongoose.Schema(
    {
        notification_id: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        type: {
            type: String,
            required: true,
            enum: ["ORDER_CREATED"],
            default: "ORDER_CREATED",
        },
        title: {
            type: String,
            required: true,
        },
        message: {
            type: String,
            required: true,
        },
        payload: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        target_roles: {
            type: [String],
            default: [],
        },
        read_by: [
            {
                employee_id: { type: String, required: true },
                read_at: { type: Date, default: getISTDate },
            },
        ],
        created_by: {
            type: String,
            required: true,
        },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    }
);

notificationSchema.index({ created_at: -1 });
notificationSchema.index({ target_roles: 1 });

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;