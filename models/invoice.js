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

    created_at: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

export default mongoose.model("Invoice", invoiceSchema);