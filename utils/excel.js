import { readFile, utils } from "xlsx";

function readExcel(filePath) {
    const workbook = readFile(filePath);

    const sheets = {};

    workbook.SheetNames.forEach((sheetName) => {
        const data = utils.sheet_to_json(workbook.Sheets[sheetName]);
        sheets[sheetName] = data;
    });

    return sheets;
}

export default { readExcel };