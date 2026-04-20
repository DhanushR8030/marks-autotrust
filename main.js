const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');

let db;
let isDbReady = false;

// JWT Secret
const JWT_SECRET = "dev_change_me_secret";

// Database helper functions
function run(sql, params = []) {
  if (!isDbReady) {
    throw new Error("Database not ready yet");
  }
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  if (!isDbReady) {
    throw new Error("Database not ready yet");
  }
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  if (!isDbReady) {
    throw new Error("Database not ready yet");
  }
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function toISOStartOfDay(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
}

function toISOEndOfDay(dateStr) {
  return new Date(`${dateStr}T23:59:59.999Z`).toISOString();
}

function parseYesNoTo01(v) {
  const s = (v || "").toString().trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" ? 1 : 0;
}

function normUpper(s) {
  return (s || "").toString().trim().toUpperCase();
}

// Database initialization
async function initDb() {
  const stockCols = await all(`PRAGMA table_info(stock)`);
  const hasOldAccountId = Array.isArray(stockCols) && stockCols.some((c) => c.name === "accountId");
  const pagesCols = await all(`PRAGMA table_info(account_pages)`);
  const entriesCols = await all(`PRAGMA table_info(account_entries)`);
  const validNotebookSchema = pagesCols.some((c) => c.name === "label") && entriesCols.some((c) => c.name === "debit");

  if (hasOldAccountId || !validNotebookSchema) {
    await run(`DROP TABLE IF EXISTS stock`);
    await run(`DROP TABLE IF EXISTS sold`);
    await run(`DROP TABLE IF EXISTS accounts`);
    await run(`DROP TABLE IF EXISTS account_entries`);
    await run(`DROP TABLE IF EXISTS account_pages`);
  }

  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS account_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL UNIQUE,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS account_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pageId INTEGER NOT NULL,
    entryDate TEXT NOT NULL,
    description TEXT NOT NULL,
    debit REAL NOT NULL DEFAULT 0,
    credit REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (pageId) REFERENCES account_pages(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicleNo TEXT NOT NULL,
    vehicleBrand TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL,
    inTime TEXT NOT NULL,
    rcStatus INTEGER NOT NULL,
    nocStatus INTEGER NOT NULL,
    purchasePrice REAL NOT NULL,
    expenses REAL NOT NULL
  )`);

  const stockColsAfterCreate = await all(`PRAGMA table_info(stock)`);
  if (Array.isArray(stockColsAfterCreate) && stockColsAfterCreate.length && !stockColsAfterCreate.some((c) => c.name === "vehicleBrand")) {
    await run(`ALTER TABLE stock ADD COLUMN vehicleBrand TEXT NOT NULL DEFAULT ''`);
  }
  
  // Add quotingPrice column if it doesn't exist
  const stockColsAfterUpdate = await all(`PRAGMA table_info(stock)`);
  if (Array.isArray(stockColsAfterUpdate) && stockColsAfterUpdate.length && !stockColsAfterUpdate.some((c) => c.name === "quotingPrice")) {
    await run(`ALTER TABLE stock ADD COLUMN quotingPrice REAL NOT NULL DEFAULT 0`);
  }

  await run(`CREATE TABLE IF NOT EXISTS sold (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicleNo TEXT NOT NULL,
    buyerName TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL,
    outTime TEXT NOT NULL,
    dealerOrBuyer TEXT NOT NULL,
    soldPrice REAL NOT NULL,
    document BLOB
  )`);

  // Add buyerName column if it doesn't exist
  const soldColsAfterCreate = await all(`PRAGMA table_info(sold)`);
  if (Array.isArray(soldColsAfterCreate) && soldColsAfterCreate.length && !soldColsAfterCreate.some((c) => c.name === "buyerName")) {
    await run(`ALTER TABLE sold ADD COLUMN buyerName TEXT NOT NULL DEFAULT ''`);
  }

  // Add document column if it doesn't exist
  if (Array.isArray(soldColsAfterCreate) && soldColsAfterCreate.length && !soldColsAfterCreate.some((c) => c.name === "document")) {
    await run(`ALTER TABLE sold ADD COLUMN document BLOB`);
  }

  const email = "athishathi555@gmail.com";
  const password = "Raaja@123";
  const existing = await get(`SELECT id FROM users WHERE email = ?`, [email]);
  if (!existing) {
    const hash = await bcrypt.hash(password, 10);
    await run(`INSERT INTO users (email, passwordHash) VALUES (?, ?)`, [email, hash]);
  }
}

// IPC Handlers
ipcMain.handle('auth-login', async (event, { email, password }) => {
  if (!isDbReady) {
    throw new Error("Database not ready yet");
  }
  try {
    console.log("=== LOGIN DEBUG START ===");
    console.log("Entered Email:", email);
    console.log("Entered Password:", password);

    const user = await get("SELECT * FROM users WHERE email = ?", [email]);

    console.log("User from DB:", user);

    if (!user) {
      console.log("User NOT FOUND");
      throw new Error("Invalid credentials");
    }

    console.log("Stored Password Hash:", user.passwordHash);

    const isMatch = bcrypt.compareSync(password, user.passwordHash);

    console.log("Password Match Result:", isMatch);

    console.log("=== LOGIN DEBUG END ===");

    if (!isMatch) {
      throw new Error("Invalid credentials");
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    
    return {
      token: token,
      user: { id: user.id, email: user.email }
    };
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return { success: false, message: "Login failed" };
  }
});

ipcMain.handle('auth-me', async (event, { token }) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { success: true, user: { id: decoded.userId, email: decoded.email } };
  } catch {
    return { success: false, message: "Invalid token" };
  }
});

// Database reset function
ipcMain.handle('reset-database', async () => {
  try {
    console.log('Database reset requested');
    
    // Close current database connection
    if (db) {
      db.close();
    }
    
    // Delete database file
    const dbPath = path.join(app.getPath("userData"), "database.db");
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log('Database file deleted');
    }
    
    // Reinitialize database
    await initDb();
    
    return { success: true, message: 'Database reset successfully' };
  } catch (error) {
    console.error('Database reset failed:', error);
    return { success: false, message: 'Database reset failed: ' + error.message };
  }
});

ipcMain.handle('get-account-pages', async (event) => {
  try {
    const pages = await all(
      `SELECT p.id,p.label,p.month,p.year,
        COALESCE((SELECT SUM(e.debit) FROM account_entries e WHERE e.pageId=p.id),0) AS totalDebit,
        COALESCE((SELECT SUM(e.credit) FROM account_entries e WHERE e.pageId=p.id),0) AS totalCredit
       FROM account_pages p ORDER BY p.year DESC,p.month DESC`
    );
    return { success: true, pages };
  } catch (error) {
    return { success: false, message: "Failed to get account pages" };
  }
});

ipcMain.handle('create-account-page', async (event, { month, year, label }) => {
  try {
    const m = Number(month);
    const y = Number(year);
    if (!Number.isInteger(m) || m < 1 || m > 12) return { success: false, message: "Invalid month" };
    if (!Number.isInteger(y) || y < 1900 || y > 3000) return { success: false, message: "Invalid year" };
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const finalLabel = (label || "").toString().trim() || `${names[m - 1]} ${y}`;
    const existing = await get(`SELECT id FROM account_pages WHERE (month=? AND year=?) OR label=?`, [m, y, finalLabel]);
    if (existing) return { success: false, message: "Page exists" };
    const result = await run(`INSERT INTO account_pages (label,month,year) VALUES (?,?,?)`, [finalLabel, m, y]);
    return { success: true, page: { id: result.lastID, label: finalLabel, month: m, year: y } };
  } catch (error) {
    return { success: false, message: "Failed to create page" };
  }
});

ipcMain.handle('delete-account-page', async (event, { id }) => {
  try {
    const pageId = Number(id);
    if (!pageId) return { success: false, message: "Invalid page id" };
    await run(`DELETE FROM account_entries WHERE pageId = ?`, [pageId]);
    await run(`DELETE FROM account_pages WHERE id = ?`, [pageId]);
    return { success: true };
  } catch (error) {
    return { success: false, message: "Failed to delete page" };
  }
});

ipcMain.handle('get-account-entries', async (event, { pageId }) => {
  try {
    const entries = await all(
      `SELECT id,entryDate,description,debit,credit FROM account_entries WHERE pageId=? ORDER BY entryDate ASC,id ASC`,
      [Number(pageId)]
    );
    const totals = await get(
      `SELECT COALESCE(SUM(debit),0) AS totalDebit, COALESCE(SUM(credit),0) AS totalCredit FROM account_entries WHERE pageId=?`,
      [Number(pageId)]
    );
    return { success: true, entries, totals: totals || { totalDebit: 0, totalCredit: 0 } };
  } catch (error) {
    return { success: false, message: "Failed to get entries" };
  }
});

ipcMain.handle('create-account-entry', async (event, { pageId, date, description, debit, credit }) => {
  try {
    const d = Number(debit || 0);
    const c = Number(credit || 0);
    if (!pageId || !description || !date) return { success: false, message: "Missing fields" };
    if (d === 0 && c === 0) return { success: false, message: "Enter debit or credit" };
    const result = await run(
      `INSERT INTO account_entries (pageId,entryDate,description,debit,credit) VALUES (?,?,?,?,?)`,
      [Number(pageId), date, description, d, c]
    );
    return { success: true, id: result.lastID };
  } catch (error) {
    return { success: false, message: "Failed to add entry" };
  }
});

ipcMain.handle('update-account-entry', async (event, { id, date, description, debit, credit }) => {
  try {
    const entryId = Number(id);
    const d = Number(debit || 0);
    const c = Number(credit || 0);
    if (!entryId) return { success: false, message: "Invalid entry id" };
    if (!date || !description) return { success: false, message: "Missing fields" };
    await run(
      `UPDATE account_entries SET entryDate = ?, description = ?, debit = ?, credit = ? WHERE id = ?`,
      [date, description, d, c, entryId]
    );
    return { success: true };
  } catch (error) {
    return { success: false, message: "Failed to update entry" };
  }
});

ipcMain.handle('delete-account-entry', async (event, { id }) => {
  try {
    const entryId = Number(id);
    if (!entryId) return { success: false, message: "Invalid entry id" };
    await run(`DELETE FROM account_entries WHERE id = ?`, [entryId]);
    return { success: true };
  } catch (error) {
    return { success: false, message: "Failed to delete entry" };
  }
});

ipcMain.handle('get-stock', async (event) => {
  try {
    const stock = await all(`
      SELECT * FROM stock 
      WHERE UPPER(TRIM(vehicleNo)) NOT IN (
        SELECT UPPER(TRIM(vehicleNo)) FROM sold
      ) 
      ORDER BY inTime DESC
    `);
    return { success: true, stock };
  } catch (error) {
    return { success: false, message: "Failed to get stock" };
  }
});

ipcMain.handle('create-stock', async (event, { vehicleNo, vehicleBrand, location, inTime, rcStatus, nocStatus, purchasePrice, expenses, quotingPrice }) => {
  try {
    const inDate = new Date(inTime);
    const purchaseNum = Number(purchasePrice);
    const expensesNum = Number(expenses);
    const quotingPriceNum = Number(quotingPrice);
    if (!(vehicleNo || "").toString().trim()) return { success: false, message: "Vehicle number is required" };
    if (!(location || "").toString().trim()) return { success: false, message: "Location is required" };
    if (!inTime || Number.isNaN(inDate.getTime())) return { success: false, message: "Valid in time is required" };
    if (!Number.isFinite(purchaseNum)) return { success: false, message: "Purchase price must be a number" };
    if (!Number.isFinite(expensesNum)) return { success: false, message: "Expenses must be a number" };
    if (!Number.isFinite(quotingPriceNum)) return { success: false, message: "Quoting price must be a number" };
    const inIso = inDate.toISOString();
    const result = await run(
      `INSERT INTO stock (vehicleNo,vehicleBrand,location,inTime,rcStatus,nocStatus,purchasePrice,expenses,quotingPrice) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        normUpper(vehicleNo),
        normUpper(vehicleBrand),
        normUpper(location),
        inIso,
        parseYesNoTo01(rcStatus),
        parseYesNoTo01(nocStatus),
        purchaseNum,
        expensesNum,
        quotingPriceNum,
      ]
    );
    return { success: true, id: result.lastID };
  } catch (error) {
    return { success: false, message: "Failed to add stock" };
  }
});

ipcMain.handle('update-stock', async (event, { id, vehicleNo, vehicleBrand, location, inTime, rcStatus, nocStatus, purchasePrice, expenses }) => {
  try {
    const stockId = Number(id);
    const inDate = new Date(inTime);
    const purchaseNum = Number(purchasePrice);
    const expensesNum = Number(expenses);
    if (!stockId) return { success: false, message: "Invalid stock id" };
    if (!(vehicleNo || "").toString().trim()) return { success: false, message: "Vehicle number is required" };
    if (!(location || "").toString().trim()) return { success: false, message: "Location is required" };
    if (!inTime || Number.isNaN(inDate.getTime())) return { success: false, message: "Valid in time is required" };
    if (!Number.isFinite(purchaseNum)) return { success: false, message: "Purchase price must be a number" };
    if (!Number.isFinite(expensesNum)) return { success: false, message: "Expenses must be a number" };
    const inIso = inDate.toISOString();
    await run(
      `UPDATE stock SET vehicleNo=?, vehicleBrand=?, location=?, inTime=?, rcStatus=?, nocStatus=?, purchasePrice=?, expenses=? WHERE id=?`,
      [
        normUpper(vehicleNo),
        normUpper(vehicleBrand),
        normUpper(location),
        inIso,
        parseYesNoTo01(rcStatus),
        parseYesNoTo01(nocStatus),
        purchaseNum,
        expensesNum,
        stockId,
      ]
    );
    return { success: true };
  } catch (error) {
    return { success: false, message: "Failed to update stock" };
  }
});

ipcMain.handle('delete-stock', async (event, { id }) => {
  try {
    const stockId = Number(id);
    if (!stockId) return { success: false, message: "Invalid stock id" };
    await run(`DELETE FROM stock WHERE id = ?`, [stockId]);
    return { success: true };
  } catch (error) {
    return { success: false, message: "Failed to delete stock" };
  }
});

ipcMain.handle('get-sold', async (event) => {
  try {
    const sold = await all(`SELECT id, vehicleNo, buyerName, location, outTime, dealerOrBuyer, soldPrice, CASE WHEN document IS NOT NULL THEN 1 ELSE NULL END as document FROM sold ORDER BY outTime DESC`);
    return { success: true, sold };
  } catch (error) {
    return { success: false, message: "Failed to get sold" };
  }
});

ipcMain.handle('create-sold', async (event, data) => {
  const t0 = Date.now();
  console.log("=== CREATE-SOLD START ===");
  
  try {
    const {
      vehicleNo,
      buyerName,
      location,
      outTime,
      dealerOrBuyer,
      soldPrice,
      document
    } = data;

    // PDF buffer conversion timing
    const t1 = Date.now();
    let pdfBuffer = null;
    if (document) {
      pdfBuffer = Buffer.from(document);
    }
    console.log(`PDF buffer conversion took: ${Date.now()-t1}ms`);

    // Validation and processing
    if (!vehicleNo || !location || !outTime || !dealerOrBuyer || !soldPrice) {
      return { success: false, message: "Missing required fields" };
    }

    const vn = (vehicleNo || "").toUpperCase().trim();
    const buyer = (buyerName || "").toUpperCase().trim();
    const loc = (location || "").toUpperCase().trim();
    const dealer = (dealerOrBuyer || "").toUpperCase().trim();
    const outIso = new Date(outTime).toISOString();
    const soldPriceNum = Number(soldPrice);

    // DB INSERT timing
    const t2 = Date.now();
    const result = await run(
      `INSERT INTO sold (vehicleNo, buyerName, location, outTime, dealerOrBuyer, soldPrice, document)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [vn, buyer, loc, outIso, dealer, soldPriceNum, pdfBuffer]
    );
    console.log(`DB INSERT took: ${Date.now()-t2}ms`);

    // Stock DELETE timing
    const t3 = Date.now();
    await run(
      `DELETE FROM stock WHERE UPPER(TRIM(vehicleNo)) = UPPER(?)`,
      [vn]
    );
    console.log(`Stock DELETE took: ${Date.now()-t3}ms`);

    console.log(`=== CREATE-SOLD TOTAL: ${Date.now()-t0}ms ===`);
    return { success: true, id: result.lastID };

  } catch (error) {
    console.error("create-sold error:", error);
    console.log(`create-sold failed after: ${Date.now()-t0}ms`);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('open-pdf', async (event, id) => {
  try {
    const row = await get(`SELECT document FROM sold WHERE id = ?`, [id]);

    if (!row || !row.document) return;

    const fs = require("fs");
    const path = require("path");
    const { shell } = require("electron");

    const filePath = path.join(app.getPath("temp"), `file_${id}.pdf`);

    fs.writeFileSync(filePath, row.document);

    shell.openPath(filePath);
  } catch (error) {
    console.error("PDF OPEN ERROR:", error);
  }
});

ipcMain.handle('update-sold', async (event, { id, vehicleNo, location, outTime, dealerOrBuyer, soldPrice }) => {
  try {
    const soldId = Number(id);
    const outDate = new Date(outTime);
    const soldPriceNum = Number(soldPrice);
    if (!soldId) return { success: false, message: "Invalid sold id" };
    if (!(vehicleNo || "").toString().trim()) return { success: false, message: "Vehicle number is required" };
    if (!(location || "").toString().trim()) return { success: false, message: "Location is required" };
    if (!outTime || Number.isNaN(outDate.getTime())) return { success: false, message: "Valid out time is required" };
    if (!(dealerOrBuyer || "").toString().trim()) return { success: false, message: "Dealer or buyer is required" };
    if (!Number.isFinite(soldPriceNum)) return { success: false, message: "Sold price must be a number" };
    const vn = normUpper(vehicleNo);
    const loc = normUpper(location);
    const dealer = normUpper(dealerOrBuyer);
    const outIso = outDate.toISOString();
    await run(`BEGIN IMMEDIATE`);
    try {
      await run(
        `UPDATE sold SET vehicleNo=?, location=?, outTime=?, dealerOrBuyer=?, soldPrice=? WHERE id=?`,
        [vn, loc, outIso, dealer, soldPriceNum, soldId]
      );
      await run(`DELETE FROM stock WHERE UPPER(TRIM(vehicleNo)) = UPPER(?)`, [vn]);
      await run(`COMMIT`);
      return { success: true };
    } catch (e) {
      try {
        await run(`ROLLBACK`);
      } catch (_) {}
      throw e;
    }
  } catch (error) {
    return { success: false, message: "Failed to update sold" };
  }
});

ipcMain.handle('delete-sold', async (event, { id }) => {
  try {
    const soldId = Number(id);
    if (!soldId) return { success: false, message: "Invalid sold id" };
    await run(`DELETE FROM sold WHERE id = ?`, [soldId]);
    return { success: true };
  } catch (error) {
    return { success: false, message: "Failed to delete sold" };
  }
});

ipcMain.handle('filter-stock', async (event, { fromDate, toDate, search }) => {
  try {
    const where = [];
    const params = [];
    if (search) {
      where.push(`(vehicleNo LIKE '%' || ? || '%' OR vehicleBrand LIKE '%' || ? || '%' OR location LIKE '%' || ? || '%')`);
      params.push(search, search, search);
    }
    if (fromDate) {
      where.push(`inTime >= ?`);
      params.push(toISOStartOfDay(fromDate));
    }
    if (toDate) {
      where.push(`inTime <= ?`);
      params.push(toISOEndOfDay(toDate));
    }
    const sql = `SELECT * FROM stock ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY inTime DESC`;
    const stock = await all(sql, params);
    return { success: true, stock };
  } catch (error) {
    return { success: false, message: "Failed to filter stock" };
  }
});

ipcMain.handle('filter-accounts', async (event, { fromDate, toDate, search }) => {
  try {
    const searchText = (search || "").toString().trim();
    const from = (fromDate || "").toString().trim();
    const to = (toDate || "").toString().trim();
    const where = [];
    const params = [];
    if (searchText) {
      where.push(`description LIKE '%' || ? || '%' COLLATE NOCASE`);
      params.push(searchText);
    }
    if (from) {
      where.push(`date(e.entryDate) >= date(?)`);
      params.push(from);
    }
    if (to) {
      where.push(`date(e.entryDate) <= date(?)`);
      params.push(to);
    }
    const sql = `
      SELECT e.id, e.entryDate, e.description, e.debit, e.credit, p.label AS pageLabel
      FROM account_entries e
      JOIN account_pages p ON p.id = e.pageId
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY e.entryDate DESC, e.id DESC
    `;
    const entries = await all(sql, params);
    return { success: true, entries };
  } catch (error) {
    return { success: false, message: "Failed to filter accounts" };
  }
});

ipcMain.handle('filter-sold', async (event, { fromDate, toDate, search }) => {
  try {
    const where = [];
    const params = [];
    if (search) {
      where.push(`(vehicleNo LIKE '%' || ? || '%' OR location LIKE '%' || ? || '%' OR dealerOrBuyer LIKE '%' || ? || '%')`);
      params.push(search, search, search);
    }
    if (fromDate) {
      where.push(`outTime >= ?`);
      params.push(toISOStartOfDay(fromDate));
    }
    if (toDate) {
      where.push(`outTime <= ?`);
      params.push(toISOEndOfDay(toDate));
    }
    const sql = `SELECT * FROM sold ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY outTime DESC`;
    const sold = await all(sql, params);
    return { success: true, sold };
  } catch (error) {
    return { success: false, message: "Failed to filter sold" };
  }
});

ipcMain.handle('filter-vehicle-status', async (event, { vehicleNo }) => {
  try {
    const vn = (vehicleNo || "").toString().trim();
    if (!vn) return { success: false, message: "vehicleNo is required" };
    const stock = await all(`SELECT * FROM stock WHERE vehicleNo = ? ORDER BY inTime DESC`, [vn]);
    const sold = await all(`SELECT * FROM sold WHERE vehicleNo = ? ORDER BY outTime DESC`, [vn]);
    return { success: true, vehicleNo, status: { inStock: stock.length > 0, inSold: sold.length > 0 }, stock, sold };
  } catch (error) {
    return { success: false, message: "Failed to get vehicle status" };
  }
});

ipcMain.handle('get-stock-by-date', async (event, { fromDate, toDate }) => {
  try {
    console.log("=== GET-STOCK-BY-DATE CALLED ===");
    console.log("fromDate:", fromDate, "toDate:", toDate);
    
    if (!fromDate || !toDate) {
      return { success: false, message: "Both fromDate and toDate are required" };
    }
    
    const stock = await all(
      `SELECT * FROM stock 
       WHERE DATE(inTime) >= DATE(?) 
       AND DATE(inTime) <= DATE(?) 
       ORDER BY inTime DESC`,
      [fromDate, toDate]
    );
    
    console.log("query result:", stock);
    return { success: true, data: stock };
  } catch (error) {
    console.error("get-stock-by-date error:", error);
    return { success: false, message: "Failed to fetch stock data" };
  }
});

ipcMain.handle('get-sold-by-date', async (event, { fromDate, toDate }) => {
  try {
    console.log("=== GET-SOLD-BY-DATE CALLED ===");
    console.log("fromDate:", fromDate, "toDate:", toDate);
    
    if (!fromDate || !toDate) {
      return { success: false, message: "Both fromDate and toDate are required" };
    }
    
    const sold = await all(
      `SELECT * FROM sold 
       WHERE DATE(outTime) >= DATE(?) 
       AND DATE(outTime) <= DATE(?) 
       ORDER BY outTime DESC`,
      [fromDate, toDate]
    );
    
    console.log("query result:", sold);
    return { success: true, data: sold };
  } catch (error) {
    console.error("get-sold-by-date error:", error);
    return { success: false, message: "Failed to fetch sold data" };
  }
});

ipcMain.handle('search-vehicle', async (event, { vehicleNo }) => {
  try {
    console.log("=== SEARCH-VEHICLE IPC CALLED ===");
    console.log("vehicleNo received:", vehicleNo);
    
    const stockRow = await get(
      `SELECT * FROM stock WHERE UPPER(TRIM(vehicleNo)) = UPPER(TRIM(?))`,
      [vehicleNo]
    );
    console.log("stock result:", stockRow);
    
    const soldRow = await get(
      `SELECT * FROM sold WHERE UPPER(TRIM(vehicleNo)) = UPPER(TRIM(?))`,
      [vehicleNo]
    );
    console.log("sold result:", soldRow);
    
    return { 
      success: true, 
      stock: stockRow || null, 
      sold: soldRow || null 
    };
  } catch (error) {
    console.error("search-vehicle error:", error);
    return { success: false, message: "Failed to search vehicle" };
  }
});

// Select PDF file dialog
ipcMain.handle('select-pdf-file', async (event) => {
  const t0 = Date.now();
  console.log("=== SELECT-PDF-FILE START ===");
  
  const { dialog, BrowserWindow } = require('electron');
  const win = BrowserWindow.getFocusedWindow();
  
  const result = await dialog.showOpenDialog(win, {
    title: 'Select PDF Document',
    buttonLabel: 'Select',
    properties: ['openFile', 'dontAddToRecent'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  console.log(`Dialog open took: ${Date.now()-t0}ms`);
  
  if (result.canceled || !result.filePaths.length) return null;
  
  const fs = require('fs').promises;
  const path = require('path');
  const filePath = result.filePaths[0];
  const fileName = path.basename(filePath);
  
  const buffer = await fs.readFile(filePath);
  console.log(`File read took: ${Date.now()-t0}ms`);
  
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset, 
    buffer.byteOffset + buffer.byteLength
  );
  
  console.log(`=== SELECT-PDF-FILE TOTAL: ${Date.now()-t0}ms ===`);
  return { name: fileName, arrayBuffer, size: buffer.length };
});

// Create window
// Create window
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: "Marks Autotrust",
    icon: path.join(__dirname, "marks_autotrust.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'client', 'build', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    win.setTitle("Marks Autotrust");
  });
}

// Initialize database and start app
app.whenReady().then(async () => {

  const userDataPath = app.getPath("userData");
  const dbPath = path.join(userDataPath, "database.db");

  console.log("Database Path:", dbPath);

  // Ensure directory exists
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  // Initialize DB and WAIT for it
  await new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error("DB ERROR:", err);
        reject(err);
      } else {
        console.log("Database connected successfully");
        isDbReady = true;
        resolve();
      }
    });
  });

  // Initialize database schema
  await initDb();

  // Auto-fix user credentials
  const bcrypt = require("bcryptjs");
  const email = "athishathi555@gmail.com";
  const plainPassword = "Raaja@123";

  // Check if user exists
  const existingUser = await get("SELECT * FROM users WHERE email = ?", [email]);

  if (!existingUser) {
    // Create new user with hashed password
    const hashedPassword = bcrypt.hashSync(plainPassword, 10);

    await run(
      "INSERT INTO users (email, passwordHash) VALUES (?, ?)",
      [email, hashedPassword]
    );

    console.log("User created with correct credentials");
  } else {
    // Update password to correct hash
    const hashedPassword = bcrypt.hashSync(plainPassword, 10);

    await run(
      "UPDATE users SET passwordHash = ? WHERE email = ?",
      [hashedPassword, email]
    );

    console.log("User password reset successfully");
  }

  // ONLY AFTER DB READY -> create window
  createWindow();

});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    db.close();
    app.quit();
  }
});

// Check vehicle exists in stock
ipcMain.handle('check-vehicle-in-stock', async (event, data) => {
  const t0 = Date.now();
  console.log("=== CHECK-VEHICLE-IN-STOCK START ===");
  
  try {
    const vehicleNo = typeof data === 'string' ? data : data?.vehicleNo;
    const vn = (vehicleNo || "").toUpperCase().trim();

    const row = await get(
      `SELECT id FROM stock 
       WHERE UPPER(TRIM(vehicleNo)) = ?`,
      [vn]
    );

    console.log(`check-vehicle-in-stock took: ${Date.now()-t0}ms`);
    return { exists: !!row };

  } catch (error) {
    console.error("Stock check error:", error);
    console.log(`check-vehicle-in-stock failed after: ${Date.now()-t0}ms`);
    return { exists: false };
  }
});