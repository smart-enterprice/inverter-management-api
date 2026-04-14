// utils/brandUtils.js
const toStr = (val) =>
    val === null || val === undefined ? "" : String(val).trim();

const toUpperArray = (val) =>
    [...new Set(
        toStr(val)
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
    )];

export const normalizeToUpper = (value) => {
    if (typeof value !== "string") return "";
    return value.trim().toUpperCase();
};

export const normalizeModels = (models = []) => {
    if (!Array.isArray(models)) return [];

    return models
        .filter(Boolean)
        .map(normalizeToUpper)
        .filter((m) => m.length > 0);
};

export const mergeUniqueModels = (existingModels = [], incomingModels = []) => {
    const normalizedExisting = normalizeModels(existingModels);
    const normalizedIncoming = normalizeModels(incomingModels);

    return [...new Set([...normalizedExisting, ...normalizedIncoming])];
};

export const getBrandsFromRow = (row) => {
    const possibleKeys = [
        "Brand",
        "Brand (comma-separated for multiple)",
        "Brand (comma-separated)",
        "Brand (optional)",
    ];

    for (const key of possibleKeys) {
        const value = row[key];

        if (value) {
            const parsed = toUpperArray(value);

            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    }

    return [];
};

export const getModelsFromRow = (row) => {
    const possibleKeys = [
        "Models",
        "Models (comma-separated)",
        "Models (optional)",
    ];

    for (const key of possibleKeys) {
        const value = row[key];

        if (value) {
            const parsed = toUpperArray(value);

            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    }

    return [];
};