import mongoose from "mongoose";
import { BadRequestException } from "../middleware/CustomError.js";

function getISTDate() {
    const date = new Date();
    const utcOffset = 330;
    return new Date(date.getTime() + utcOffset * 60000);
}

const VALID_ORDER_STATUSES = ["PENDING", "APPROVED", "CANCELLED", "IN_PROGRESS", "DELIVERED", "PENDING_PRODUCTION"];

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
        default: "PENDING",
    },
    promised_delivery_date: {
        type: Date
    },

    order_total_price: {
        type: Number,
        required: [true, "💰 Order total price is required."],
        min: [0, "Price must be a positive number."],
    },
    order_total_discount: {
        type: Number,
        required: [true, "💰 Order total discount amount is required."],
        min: [0, "Price must be a positive number."],
    },

    payment_status: {
        type: String,
        default: "PENDING",
    },
    payment_type: {
        type: String,
        default: "CASH", // CASH, ONLINE, CHEQUE, etc.
    },
    amount_paid: {
        type: Number,
        default: 0,
        min: [0, "Amount paid cannot be negative."],
    },
    amount_due: {
        type: Number,
        default: function() {
            return this.order_total_price;
        },
        min: [0, "Amount due cannot be negative."],
    },
    last_payment_date: {
        type: Date,
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

orderSchema.pre("save", function(next) {
    const istNow = getISTDate();
    if (this.isNew) this.created_at = istNow;
    this.updated_at = istNow;

    if (this.amount_paid === 0) {
        this.payment_status = "PENDING";
    } else if (this.amount_paid > 0 && this.amount_paid < this.order_total_price) {
        this.payment_status = "PARTIALLY_PAID";
    } else if (this.amount_paid >= this.order_total_price) {
        this.payment_status = "PAID";
    }

    this.amount_due = Math.max(this.order_total_price - this.amount_paid, 0);

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
        if (!VALID_ORDER_STATUSES.includes(newStatus)) {
            throw new BadRequestException(`Invalid status: ${newStatus}`);
        }
        this.status = newStatus;
        await this.save();
        return this;
    }

    async updatePayment(amount) {
        if (amount <= 0) {
            throw new BadRequestException("Payment amount must be greater than zero.");
        }
        this.amount_paid += amount;
        this.last_payment_date = getISTDate();
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

    static async findByOrderStatus(status) {
        if (!VALID_ORDER_STATUSES.includes(status)) {
            throw new BadRequestException(`Invalid order status: ${status}`);
        }
        return await this.find({ status });
    }

}