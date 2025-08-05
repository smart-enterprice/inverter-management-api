import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    const utcOffset = 330; // IST offset in minutes
    return new Date(date.getTime() + utcOffset * 60000);
}

const brandSchema = new mongoose.Schema({
    brand_id: {
        type: String,
        required: [true, "🚨 Brand ID is required!"],
        unique: true,
        trim: true,
    },
    brand_name: {
        type: String,
        required: [true, "🚨 Brand name is required!"],
        unique: true,
        trim: true,
    },
    brand_models: {
        type: [String],
        default: [],
        validate: {
            validator: arr => Array.isArray(arr),
            message: "brand_models must be an array of strings."
        },
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

brandSchema.pre('save', function(next) {
    const istNow = getISTDate();
    if (this.isNew) this.created_at = istNow;
    this.updated_at = istNow;
    next();
});

brandSchema.pre('findOneAndUpdate', function(next) {
    this._update.updated_at = getISTDate();
    next();
});

const BrandModel = mongoose.model("Brand", brandSchema);

export default class Brand extends BrandModel {
    constructor(brandData) {
        super(brandData);
    }

    static async getAllBrands() {
        return await this.find({});
    }
}