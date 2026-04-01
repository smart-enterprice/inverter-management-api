export function generatePassword(name) {
    const firstName = name?.trim()
        ?.split(" ")[0]
        ?.toLowerCase()
        ?.replace(/^./, (c) => c.toUpperCase()) || "User";

    return `${firstName}-smartinvert@#12321`;
}