import mongoose from "mongoose";

const companyAddressSchema = new mongoose.Schema({
    company_address_id: {
        type: String,
        required: true,
        unique: true
    },

    company_name: {
        type: String,
        required: true,
        trim: true
    },

    gst_number: {
        type: String,
        trim: true
    },

    email: {
        type: String,
        lowercase: true,
        trim: true
    },

    phone: {
        type: String
    },

    address_line_1: {
        type: String,
        required: true
    },

    address_line_2: {
        type: String
    },

    company_logo: {
        type: String,
    },

    city: {
        type: String,
        required: true
    },

    state: {
        type: String,
        required: true
    },

    pincode: {
        type: String,
        required: true
    },

    country: {
        type: String,
        default: "India"
    },

    is_active: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

export default mongoose.model("CompanyAddress", companyAddressSchema);