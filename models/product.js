import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    const utcOffset = 330;
    return new Date(date.getTime() + utcOffset * 60000);
}

const productSchema = new mongoose.Schema({
    product_id: {
        type: String,
        required: [true, "🚨 Product ID is required!"],
        unique: true,
    },
    brand: {
        type: String,
        required: [true, "🚨 Brand is required!"]
    },
    product_name: {
        type: String,
        required: [true, "🚨 Product Name is required."]
    },
    model: {
        type: String,
        required: [true, "📧 Model is required."]
    },
    product_type: {
        type: String,
        required: [true, "📱 Product Type is required."]
    },
    status: {
        type: String,
        default: "active",
    },
    available_stock: {
        type: Number,
        default: 0,
        min: [0, "Stock cannot be negative."],
    },
    price: {
        type: Number,
        required: [true, "💰 Product price is required."],
        min: [0, "Price must be a positive number."],
    },
    created_by: {
        type: String,
        required: [true, "📝 Creator ID is required."],
    },
    log_note: {
        type: String,
    },
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    },
});

productSchema.pre('save', function (next) {
    const istNow = getISTDate();
    if (this.isNew) this.created_at = istNow;
    this.updated_at = istNow;
    next();
});

productSchema.pre('findOneAndUpdate', function (next) {
    this._update.updated_at = getISTDate();
    next();
});

productSchema.statics.getActiveProductById = function (productId) {
    return this.findOne({ product_id: productId, status: 'active' });
};

productSchema.statics.getActiveProducts = function (filter = {}) {
    return this.find({ ...filter, status: 'active' }).sort({ created_at: -1 });
};

productSchema.statics.getAllProducts = function (filter = {}) {
    return this.find({ ...filter }).sort({ created_at: -1 });
};

productSchema.statics.getAllByBrands = function (brandName) {
    return this.find({ brand: brandName });
};

const Product = mongoose.model("Product", productSchema);
export default Product;