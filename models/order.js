import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    const utcOffset = 330;
    return new Date(date.getTime() + utcOffset * 60000);
}

const orderSchema = new mongoose.Schema({
    order_number: {
        type: String,
        required: [true, "🚨 Order Number is required!"],
        unique: true,
    },
    dealer_id: {
        type: String,
        required: [true, "🚨 Dealer ID is required!"],
    },
    created_by: {
        type: String,
        required: [true, "📝 Creator ID is required!"],
    },
    salesman_id: {
        type: String,
        required: [true, "🚨 Salesman ID is required!"],
    },
    priority: {
        type: String,
        default: "LOW", // LOW, MEDIUM, HIGH
    },
    order_note: {
        type: String,
        default: "",
    },
    status: {
        type: String,
        default: "PENDING", // enum: ["pending", "approved", "cancelled", "in_progress", "delivered"],
    },
    promised_delivery_date: {
        type: Date
    },
    sales_target_updated: {
        type: Boolean,
        default: false,
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    },
});

orderSchema.pre('save', function(next) {
    const istNow = getISTDate();
    if (this.isNew) this.created_at = istNow;
    this.updated_at = istNow;
    next();
});

orderSchema.pre('findOneAndUpdate', function(next) {
    this._update.updated_at = getISTDate();
    next();
});

const OrderModel = mongoose.model("Order", orderSchema);

export default class Order extends OrderModel {
    constructor(orderData) {
        super(orderData);
    }

    async updateStatus(newStatus) {
        const validStatuses = ["PENDING", "APPROVED", "CANCELLED", "IN_PROGRESS", "DELIVERED", ];
        if (!validStatuses.includes(newStatus)) {
            throw new Error(`Invalid status: ${newStatus}`);
        }
        this.status = newStatus;
        await this.save();
        return this;
    }

    async markSalesTargetUpdated() {
        this.sales_target_updated = true;
        await this.save();
        return this;
    }

    static async findByOrderNumber(orderNumber) {
        return await this.findOne({ order_number: orderNumber });
    }
    
}