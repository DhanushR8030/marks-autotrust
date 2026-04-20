const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const dbPath = path.join(
  os.homedir(), 
  'AppData', 'Roaming', 'marks-autotrust', 'database.db'
);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Cannot open database:', err.message);
    return;
  }
  console.log('Database opened successfully');
  console.log('Database path:', dbPath);
});

// Check sold table structure
db.all(`PRAGMA table_info(sold)`, [], (err, cols) => {
  if (err) { console.error(err); return; }
  console.log('\nSOLD TABLE COLUMNS:');
  cols.forEach(c => console.log(`  - ${c.name} (${c.type})`));
});

// Check all sold records and their PDF status
db.all(`SELECT id, vehicleNo, buyerName, soldPrice,
  CASE WHEN document IS NOT NULL THEN 'YES - ' || LENGTH(document) || ' bytes' 
  ELSE 'NO PDF' END as hasPdf
  FROM sold ORDER BY id DESC`, [], (err, rows) => {
  if (err) { console.error(err); return; }
  console.log('\nSOLD RECORDS AND PDF STATUS:');
  if (!rows.length) {
    console.log('  No sold records found');
    return;
  }
  rows.forEach(r => {
    console.log(`  ID: ${r.id} | Vehicle: ${r.vehicleNo} | Buyer: ${r.buyerName} | PDF: ${r.hasPdf}`);
  });
  
  const withPdf = rows.filter(r => r.hasPdf !== 'NO PDF').length;
  const withoutPdf = rows.filter(r => r.hasPdf === 'NO PDF').length;
  console.log(`\nSUMMARY:`);
  console.log(`  Total records: ${rows.length}`);
  console.log(`  Records WITH PDF: ${withPdf}`);
  console.log(`  Records WITHOUT PDF: ${withoutPdf}`);
  
  db.close();
});
