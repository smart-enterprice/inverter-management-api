import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    const utcOffsetMinutes = 330;
    return new Date(date.getTime() + utcOffsetMinutes * 60000);
}

const stockSchema = new mongoose.Schema({
    stock_id: {
        type: String,
        required: [true, "🚨 Stock ID is required!"],
        unique: true,
        trim: true
    },
    product_id: {
        type: String,
        required: [true, "🚨 Product ID is required!"],
        trim: true
    },
    stock: {
        type: Number,
        required: [true, "🚨 Stock amount is required!"],
        min: [0, "Stock cannot be negative"]
    },
    add_stock: {
        type: Number,
        default: 0,
        min: [0, "Add stock cannot be negative"]
    },
    return_stock: {
        type: Number,
        default: 0,
        min: [0, "Return stock cannot be negative"]
    },
    stock_action: {
        type: String,
        required: [true, "⚠️ Stock action is required!"],
        enum: {
            values: ["ADD", "RETURN", "ORDERED", "OTHER"],
            message: "Invalid stock type"
        },
        trim: true
    },
    stock_type: {
        type: String,
        required: [true, "⚠️ Stock type is required!"],
        enum: {
            values: ["PACKED", "UNPACKED", "SALE", "OTHER"],
            message: "Invalid stock type"
        },
        trim: true
    },
    stock_notes: {
        type: String,
        trim: true
    },
    order_number: {
        type: String,
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

stockSchema.pre('save', function(next) {
    const istNow = getISTDate();
    if (this.isNew) {
        this.created_at = istNow;
    }
    this.updated_at = istNow;
    next();
});

stockSchema.pre('findOneAndUpdate', function(next) {
    this._update.updated_at = getISTDate();
    next();
});

const Stock = mongoose.model("Stock", stockSchema);
export default Stock;