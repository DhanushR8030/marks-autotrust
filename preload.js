const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {

  // Auth
  authLogin: (credentials) => ipcRenderer.invoke('auth-login', credentials),
  authMe: (token) => ipcRenderer.invoke('auth-me', { token }),

  // Account Pages
  getAccountPages: () => ipcRenderer.invoke('get-account-pages'),
  createAccountPage: (month, year, label) =>
    ipcRenderer.invoke('create-account-page', { month, year, label }),
  deleteAccountPage: (id) =>
    ipcRenderer.invoke('delete-account-page', { id }),

  // Account Entries
  getAccountEntries: (pageId) =>
    ipcRenderer.invoke('get-account-entries', { pageId }),
  createAccountEntry: (pageId, date, description, debit, credit) =>
    ipcRenderer.invoke('create-account-entry', { pageId, date, description, debit, credit }),
  updateAccountEntry: (id, date, description, debit, credit) =>
    ipcRenderer.invoke('update-account-entry', { id, date, description, debit, credit }),
  deleteAccountEntry: (id) =>
    ipcRenderer.invoke('delete-account-entry', { id }),

  // Stock
  getStock: () => ipcRenderer.invoke('get-stock'),
  createStock: (vehicleNo, vehicleBrand, location, inTime, rcStatus, nocStatus, purchasePrice, expenses, quotingPrice) =>
    ipcRenderer.invoke('create-stock', {
      vehicleNo,
      vehicleBrand,
      location,
      inTime,
      rcStatus,
      nocStatus,
      purchasePrice,
      expenses,
      quotingPrice
    }),
  updateStock: (id, vehicleNo, vehicleBrand, location, inTime, rcStatus, nocStatus, purchasePrice, expenses) =>
    ipcRenderer.invoke('update-stock', {
      id,
      vehicleNo,
      vehicleBrand,
      location,
      inTime,
      rcStatus,
      nocStatus,
      purchasePrice,
      expenses
    }),
  deleteStock: (id) =>
    ipcRenderer.invoke('delete-stock', { id }),

  // Stock Check (FIXED)
  checkVehicleInStock: (vehicleNo) =>
    ipcRenderer.invoke('check-vehicle-in-stock', vehicleNo),
  
  // Search Vehicle (MISSING - ADDING)
  searchVehicle: (vehicleNo) =>
    ipcRenderer.invoke('search-vehicle', { vehicleNo }),

  // Sold
  getSold: () => ipcRenderer.invoke('get-sold'),
  createSold: (formData) =>
    ipcRenderer.invoke('create-sold', formData),
  openPdf: (id) =>
    ipcRenderer.invoke('open-pdf', id),
  updateSold: (id, vehicleNo, location, outTime, dealerOrBuyer, soldPrice) =>
    ipcRenderer.invoke('update-sold', {
      id,
      vehicleNo,
      location,
      outTime,
      dealerOrBuyer,
      soldPrice
    }),
  deleteSold: (id) =>
    ipcRenderer.invoke('delete-sold', { id }),

  // Filters
  filterStock: (fromDate, toDate, search) =>
    ipcRenderer.invoke('filter-stock', { fromDate, toDate, search }),
  filterAccounts: (fromDate, toDate, search) =>
    ipcRenderer.invoke('filter-accounts', { fromDate, toDate, search }),
  filterSold: (fromDate, toDate, search) =>
    ipcRenderer.invoke('filter-sold', { fromDate, toDate, search }),

  // Stock Analysis
  getStockByDate: (fromDate, toDate) =>
    ipcRenderer.invoke('get-stock-by-date', { fromDate, toDate }),
  getSoldByDate: (fromDate, toDate) =>
    ipcRenderer.invoke('get-sold-by-date', { fromDate, toDate }),

  // PDF File Selection
  selectPdfFile: () => ipcRenderer.invoke('select-pdf-file'),

});