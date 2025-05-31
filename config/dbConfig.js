// dbconfig.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import { dbLogger } from "../utils/logger.js";

dotenv.config();

const MONGO_URL = process.env.MONGO_URL;

export const connectToDatabase = async() => {
    try {
        await mongoose.connect(MONGO_URL);
        dbLogger.info("Database connected successfully", {
            database: mongoose.connection.name,
        });

        mongoose.connection.on("error", (error) => {
            dbLogger.error("MongoDB connection error", { error: error.message });
        });

        mongoose.connection.on("disconnected", () => {
            dbLogger.warn("MongoDB disconnected");
        });

        mongoose.connection.on("reconnected", () => {
            dbLogger.info("MongoDB reconnected");
        });
    } catch (error) {
        dbLogger.error("Failed to connect to database", { error: error.message });
        process.exit(1);
    }
};

export const closeDatabaseConnection = async() => {
    try {
        await mongoose.connection.close(false);
        dbLogger.info("MongoDB connection closed");
    } catch (error) {
        dbLogger.error("Error during MongoDB disconnection", { error: error.message });
    }
};