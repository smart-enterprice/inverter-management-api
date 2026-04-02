export function generatePassword(name) {
    const firstName = name?.trim()
        ?.split(" ")[0]
        ?.toLowerCase()
        ?.replace(/^./, (c) => c.toUpperCase()) || "User";

    return `${firstName}-smartinvert@#12321`;
}

export function generateUniqueEmail(name) {
    const formattedName = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, "");

    return `${formattedName}@smartenterprises.com`;
}