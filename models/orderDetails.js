import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    const utcOffset = 330;
    return new Date(date.getTime() + utcOffset * 60000);
}

const orderDetailsSchema = new mongoose.Schema({
    order_details_number: {
        type: String,
        required: [true, "🚨 Order Details ID is required!"],
    },
    order_number: {
        type: String,
        required: [true, "🚨 Order ID is required!"],
    },
    product_id: {
        type: String,
        required: [true, "🆔 Product ID is required!"],
    },
    product_brand: {
        type: String,
        required: [true, "🚨 Brand is required!"],
    },
    product_name: {
        type: String,
        required: [true, "🚨 Product Name is required."],
    },
    product_model: {
        type: String,
        required: [true, "📧 Model is required."],
    },
    product_type: {
        type: String,
        required: [true, "📱 Product Type is required."],
    },
    qty_ordered: {
        type: Number,
        required: [true, "🔢 Quantity Ordered is required."],
        min: [1, "❌ Quantity must be at least 1."],
    },
    qty_delivered: {
        type: Number,
        default: 0,
        min: [0, "❌ Quantity Delivered cannot be negative."],
    },
    delivery_date: {
        type: Date,
        required: [true, "📅 Delivery date is required."],
    },
    status: {
        type: String,
        // enum: ["PENDING", "DISPATCHED", "DELIVERED", "CANCELLED"],
        default: "PENDING",
    },
}, {
    timestamps: {
        createdAt: "created_at",
        updatedAt: "updated_at",
    },
});

orderDetailsSchema.pre("save", function(next) {
    const istNow = getISTDate();
    if (this.isNew) this.created_at = istNow;
    this.updated_at = istNow;
    next();
});

orderDetailsSchema.pre("findOneAndUpdate", function(next) {
    this._update.updated_at = getISTDate();
    next();
});

const OrderDetails = mongoose.model("OrderDetails", orderDetailsSchema);

export default OrderDetails;