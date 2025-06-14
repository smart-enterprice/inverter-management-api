// stock.js
import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    const utcOffsetMinutes = 330; // IST is UTC+5:30
    return new Date(date.getTime() + utcOffsetMinutes * 60000);
}

const stockSchema = new mongoose.Schema({
    stock_id: {
        type: String,
        required: [true, "🚨 Stock ID is required!"],
        unique: true
    },
    product_id: {
        type: String,
        required: [true, "🚨 Product ID is required!"],
        unique: true
    },
    stock: {
        type: Number,
        required: [true, "🚨 Stock is required!"]
    },
    add_stock: {
        type: Number,
        default: 0
    },
    return_stock: {
        type: Number,
        default: 0
    },
    stock_notes: {
        type: String
    },
    created_by: {
        type: String,
        required: [true, "📝 Creator ID is required."]
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