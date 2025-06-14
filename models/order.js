import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    const utcOffset = 330;
    return new Date(date.getTime() + utcOffset * 60000);
}

const orderSchema = new mongoose.Schema({
    order_id: {
        type: String,
        required: [true, "🚨 Order ID is required!"],
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
    priority: {
        type: String,
        // LOW, MEDIUM, HIGH
        default: "LOW",
    },
    order_note: {
        type: String,
        default: "",
    },
    status: {
        type: String,
        // enum: ["pending", "approved", "cancelled", "in_progress", "delivered"],
        default: "PENDING",
    },
    delivery_date: {
        type: Date,
    },
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

const Order = mongoose.model("Order", orderSchema);
export default Order;
