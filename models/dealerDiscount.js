import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    const utcOffset = 330;
    return new Date(date.getTime() + utcOffset * 60000);
}

const dealerDiscountSchema = new mongoose.Schema({
    dealer_discount_id: {
        type: String,
        required: [true, "🚨 Dealer Discount ID is required!"],
        trim: true,
    },
    brand_name: {
        type: String,
        required: [true, "🚨 Brand name is required!"],
        trim: true,
    },
    model_name: {
        type: String,
        required: [true, "🚨 Model name is required!"],
        trim: true,
    },
    dealer_id: {
        type: String,
        required: [true, "🚨 Dealer ID is required!"],
        trim: true,
    },
    product_ids: {
        type: [String],
        default: []
    },
    discount_value: {
        type: Number,
        required: [true, "💰 Discount value is required!"],
        min: [0, "Discount value cannot be negative"],
    },
    is_percentage: {
        type: Boolean,
        required: [true, "🏷️ Must specify if discount is percentage (true) or price (false)"],
    },
    description: {
        type: String,
        default: ""
    },
    created_by: {
        type: String,
        required: [true, "📝 Creator ID is required!"],
    },
    status: {
        type: String,
        default: "active",
    },
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    },
});

dealerDiscountSchema.index({ dealerDiscountId: 1, model_name: 1, dealer_id: 1 }, { unique: true, name: "unique_dealerDiscount_model_dealer" });

dealerDiscountSchema.pre('save', function (next) {
    const istNow = getISTDate();
    if (this.isNew) this.created_at = istNow;
    this.updated_at = istNow;
    next();
});

dealerDiscountSchema.pre('findOneAndUpdate', function (next) {
    this._update.updated_at = getISTDate();
    next();
});

const DealerDiscountModel = mongoose.model("DealerDiscount", dealerDiscountSchema);

export default class DealerDiscount extends DealerDiscountModel {
    constructor(data) {
        super(data);
    }

    static async getAllDiscounts() {
        return await this.find({});
    }

    isPercentage() {
        return this.is_percentage;
    }

    calculateDiscountedPrice(originalPrice) {
        if (this.is_percentage) {
            return originalPrice - (originalPrice * this.discount_value / 100);
        }
        return originalPrice - this.discount_value;
    }

}