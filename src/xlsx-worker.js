/* Parses an untrusted spreadsheet in isolation; the page only receives plain strings back. */
importScripts('lib/xlsx.sheet.js');
self.onmessage = function (e) {
  try {
    var wb = XLSX.read(new Uint8Array(e.data.bytes), {type: 'array', cellDates: true});
    var names = e.data.first ? wb.SheetNames.slice(0, 1) : wb.SheetNames;
    self.postMessage({ok: true, sheets: names.map(function (n) {
      var ws = wb.Sheets[n];
      return {name: String(n), html: ws && ws['!ref'] ? String(XLSX.utils.sheet_to_html(ws, {editable: false})) : ''};
    })});
  } catch (err) { self.postMessage({ok: false, error: String(err && err.message || err).slice(0, 200)}); }
};
