const ExcelJS = require('exceljs');

async function run() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('NEC Selections.xlsx');
  
  const ws = wb.worksheets[0];
  const newWb = new ExcelJS.Workbook();
  const newWs = newWb.addWorksheet('Filtered');

  // We loop through all rows.
  // The first row is the header, which has no color, so it gets kept.
  ws.eachRow({ includeEmpty: false }, function(row, rowNumber) {
    let keep = true;
    
    // Check the fill color of the first cell of the row
    const cell = row.getCell(1);
    if (cell.fill && cell.fill.fgColor && cell.fill.fgColor.argb === 'FFFF0000') {
      keep = false; // It's red!
    }

    if (keep) {
      // Copy values
      const newRow = newWs.addRow(row.values);
      // Optional: keep styling if needed, but not necessary for CLI tool
    }
  });

  await newWb.xlsx.writeFile('NEC_Selections_Filtered.xlsx');
  console.log('Successfully filtered rows. Saved to NEC_Selections_Filtered.xlsx');
}

run().catch(console.error);
