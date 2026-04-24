// target.js
import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    const utcOffset = 330;
    return new Date(date.getTime() + utcOffset * 60000);
}

const targetSchema = new mongoose.Schema({
    target_id: {
        type: String,
        required: [true, "🚨 Target ID is required!"],
        unique: true,
    },
    month: {
        type: String,
        required: [true, "📅 Target month is required."],
    },
    totalTarget: {
        type: Number,
        required: [true, "🎯 Total target value is required."],
    },
    created_by: {
        type: String,
        required: [true, "📝 Creator ID is required."],
    },
    assignedDate: {
        type: Date,
        default: getISTDate,
    },
    status: {
        type: String,
        default: "active",
    },
}, {
    timestamps: {
        createdAt: "created_at",
        updatedAt: "updated_at",
    },
});

targetSchema.pre("save", function(next) {
    if (this.isNew) this.created_at = getISTDate();
    this.updated_at = getISTDate();
    next();
});

targetSchema.pre("findOneAndUpdate", function(next) {
    this._update.updated_at = getISTDate();
    next();
});

const TargetModel = mongoose.model("Target", targetSchema);

export default class Target extends TargetModel {
    constructor(targetData) {
        super(targetData);
    }

    static async getAllTarget() {
        return await this.find({});
    }
}