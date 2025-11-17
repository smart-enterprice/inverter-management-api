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
        required: true,
        min: [0, "Stock cannot be negative"],
        default: 0
    },
    packed_stock: {
        type: Number,
        required: [true, "🚨 Packed stock is required!"],
        min: [0, "Packed stock cannot be negative"],
        default: 0
    },
    unpacked_stock: {
        type: Number,
        required: [true, "🚨 Unpacked stock is required!"],
        min: [0, "Unpacked stock cannot be negative"],
        default: 0
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

stockSchema.pre("save", function (next) {
    const istNow = getISTDate();

    this.stock = (this.packed_stock || 0) + (this.unpacked_stock || 0);

    if (this.isNew) {
        this.created_at = istNow;
    }
    this.updated_at = istNow;
    next();
});

stockSchema.pre("findOneAndUpdate", function (next) {
    const update = this._update;

    if (update.packed_stock !== undefined || update.unpacked_stock !== undefined) {
        const packed = update.packed_stock ?? this._update.$set?.packed_stock ?? 0;
        const unpacked = update.unpacked_stock ?? this._update.$set?.unpacked_stock ?? 0;

        update.stock = packed + unpacked;
    }

    update.updated_at = getISTDate();
    next();
});

stockSchema.statics.findByProductId = async function (productId) {
    return this.findOne({ product_id: productId });
};

stockSchema.statics.getAvailableStockByProductId = async function (productId) {
    const stocks = await this.find(
        { product_id: productId },
        { stock: 1 }
    );

    if (!stocks || stocks.length === 0) {
        return 0;
    }

    const totalStock = stocks.reduce((sum, s) => sum + (s.stock || 0), 0);
    return totalStock;
};

const Stock = mongoose.model("Stock", stockSchema);
export default Stock;