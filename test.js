import dotenv from "dotenv";

dotenv.config();

console.log("Env loaded:", process.env.MONGO_URL);