// scripts/migrate-passwords-to-bcrypt.js
//
// One-time migration: re-hash every legacy AES-encrypted password ("iv:hex")
// to bcrypt. Safe to run multiple times — already-bcrypt passwords are skipped.
// Login also lazily upgrades legacy passwords, so this script just finishes
// the job for accounts that never log in.
//
// Usage: node scripts/migrate-passwords-to-bcrypt.js

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Employee from "../models/employees.js";
import { decryptText } from "../utils/encryption.js";
import { hashPassword, isLegacyEncryptedPassword } from "../utils/employeeAuth.js";
import { MONGO_URL } from "../utils/constants.js";

const run = async () => {
    await mongoose.connect(MONGO_URL);
    console.log(`Connected to database: ${mongoose.connection.name}`);

    const employees = await Employee.find({}).select("+password");

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const employee of employees) {
        if (!employee.password || !isLegacyEncryptedPassword(employee.password)) {
            skipped++;
            continue;
        }

        try {
            const plainPassword = decryptText(employee.password);
            employee.password = await hashPassword(plainPassword);
            await employee.save();
            migrated++;
            console.log(`✅ Migrated: ${employee.employee_id} (${employee.employee_email})`);
        } catch (error) {
            failed++;
            console.error(`❌ Failed: ${employee.employee_id} — ${error.message}`);
        }
    }

    console.log(`\nDone. Migrated: ${migrated}, already bcrypt/skipped: ${skipped}, failed: ${failed}`);
    await mongoose.connection.close();
};

run().catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
});
