import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    const utcOffsetMinutes = 330;
    return new Date(date.getTime() + utcOffsetMinutes * 60000);
}

const stockHistorySchema = new mongoose.Schema({
    stock_history_id: {
        type: String,
        required: [true, "🚨 Stock History ID is required!"],
        unique: true,
        trim: true
    },
    product_id: {
        type: String,
        required: [true, "🚨 Product ID is required!"],
        trim: true
    },
    order_number: {
        type: String,
        trim: true
    },
    action: {
        type: String,
        required: true,
        trim: true
    },
    stock_type: {
        type: String,
        required: true,
        // enum: ["packed", "unpacked"]
    },
    quantity: {
        type: Number,
        required: true,
        min: [0, "Quantity cannot be negative"]
    },
    previous_stock: {
        type: Number,
        required: true
    },
    new_stock: {
        type: Number,
        required: true
    },
    notes: {
        type: String,
        trim: true
    },
    created_by: {
        type: String,
        required: [true, "📝 Creator ID is required."],
        trim: true
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
});

stockHistorySchema.pre("save", function (next) {
    const istNow = getISTDate();
    if (this.isNew) {
        this.created_at = istNow;
    }
    this.updated_at = istNow;
    next();
});

const StockHistory = mongoose.model("StockHistory", stockHistorySchema);
export default StockHistory;