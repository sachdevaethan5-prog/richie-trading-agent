// Rows of a Robinhood list answer, refusing errors and malformed payloads (used by rebuild/adapters/brokers.mjs).
export function brokerRows(text, type) {
  const parsed = JSON.parse(String(text));
  const data = parsed?.data;
  const rows = Array.isArray(data) ? data : data?.[type] ?? data?.results;
  if (!Array.isArray(rows) || rows.some(r => !r || typeof r !== 'object')) throw Error(`Invalid broker ${type} response`);
  return rows;
}
