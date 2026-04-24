import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    const utcOffset = 330;
    return new Date(date.getTime() + utcOffset * 60000);
}

const productPriceHistorySchema = new mongoose.Schema({
    price_history_id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    product_id: {
        type: String,
        required: true,
        index: true
    },

    old_price: {
        type: Number,
        default: 0
    },

    new_price: {
        type: Number,
        required: true
    },

    changed_by: {
        type: String,
        required: true
    },

    change_reason: {
        type: String,
        default: ""
    },

    is_cost_update: {
        type: Boolean,
        default: false
    },

    changed_at: {
        type: Date,
        default: getISTDate
    }

}, {
    timestamps: {
        createdAt: "created_at",
        updatedAt: false
    }
});

productPriceHistorySchema.index({ product_id: 1, changed_at: -1 });

productPriceHistorySchema.pre("save", function (next) {
    if (!this.changed_at) {
        this.changed_at = getISTDate();
    }
    next();
});

const ProductPriceHistory = mongoose.model(
    "ProductPriceHistory",
    productPriceHistorySchema
);

export default ProductPriceHistory;