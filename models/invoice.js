import mongoose from "mongoose";

const invoiceSchema = new mongoose.Schema({
    invoice_id: {
        type: String,
        required: true,
        unique: true
    },

    order_number: {
        type: String,
        required: true,
        unique: true // 🔐 One invoice per order
    },

    order_items: {
        type: Map,
        of: Number, // order_details_number → item_count
        default: {}
    },

    total_items: {
        type: Number,
        default: 0
    },

    created_at: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

invoiceSchema.pre("save", function(next) {
    this.total_items = [...this.order_items.values()]
        .reduce((sum, qty) => sum + qty, 0);
    next();
});

export default mongoose.model("Invoice", invoiceSchema);