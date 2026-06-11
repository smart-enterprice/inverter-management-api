// scripts/fix-html-entities.js
//
// Repairs data corrupted by the old sanitizeInput (validator.escape), which
// HTML-encoded text on input: "&" → "&amp;", "/" → "&#x2F;", etc. Values that
// were edited multiple times were encoded multiple times ("&amp;amp;"), and
// uppercase normalization produced variants like "&AMP;AMP;" — so decoding is
// case-insensitive and repeats until the value is stable.
//
// Safe to run multiple times. Prints every change it makes.
//
// Usage: node scripts/fix-html-entities.js [--dry-run]

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { MONGO_URL } from "../utils/constants.js";

const DRY_RUN = process.argv.includes("--dry-run");

const ENTITY_MAP = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#x27;": "'",
    "&#39;": "'",
    "&#x2f;": "/",
    "&#47;": "/",
    "&#x5c;": "\\",
    "&#96;": "`",
};

const ENTITY_REGEX = new RegExp(Object.keys(ENTITY_MAP).join("|"), "gi");

const decodeOnce = (value) =>
    value.replace(ENTITY_REGEX, (match) => ENTITY_MAP[match.toLowerCase()] ?? match);

const decodeFully = (value) => {
    let current = value;
    for (let i = 0; i < 10; i++) {           // hard cap; corruption is finite
        const decoded = decodeOnce(current);
        if (decoded === current) return current;
        current = decoded;
    }
    return current;
};

const run = async () => {
    await mongoose.connect(MONGO_URL);
    const db = mongoose.connection.db;
    console.log(`Connected to database: ${mongoose.connection.name}${DRY_RUN ? " (DRY RUN)" : ""}`);

    const collections = (await db.listCollections().toArray()).map((c) => c.name);
    let totalDocs = 0;
    let totalFields = 0;

    for (const collName of collections) {
        const coll = db.collection(collName);
        const cursor = coll.find({});

        for await (const doc of cursor) {
            const updates = {};

            for (const [key, value] of Object.entries(doc)) {
                if (typeof value === "string") {
                    const fixed = decodeFully(value);
                    if (fixed !== value) {
                        updates[key] = fixed;
                        console.log(`${collName}.${key} [${doc._id}]\n   "${value}"\n → "${fixed}"`);
                    }
                } else if (Array.isArray(value) && value.some((v) => typeof v === "string")) {
                    const fixedArr = value.map((v) => (typeof v === "string" ? decodeFully(v) : v));
                    if (JSON.stringify(fixedArr) !== JSON.stringify(value)) {
                        updates[key] = fixedArr;
                        console.log(`${collName}.${key}[] [${doc._id}]\n   ${JSON.stringify(value)}\n → ${JSON.stringify(fixedArr)}`);
                    }
                }
            }

            const changedFields = Object.keys(updates).length;
            if (changedFields > 0) {
                totalDocs++;
                totalFields += changedFields;
                if (!DRY_RUN) {
                    await coll.updateOne({ _id: doc._id }, { $set: updates });
                }
            }
        }
    }

    console.log(`\nDone. ${DRY_RUN ? "Would fix" : "Fixed"} ${totalFields} fields across ${totalDocs} documents.`);
    await mongoose.connection.close();
};

run().catch((error) => {
    console.error("Fix failed:", error);
    process.exit(1);
});
