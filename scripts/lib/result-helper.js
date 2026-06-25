function createErrorResult(error, message, details = {}) {
  return { success: false, error, message, ...details };
}

function createSuccessResult(data, message = '操作成功') {
  return { success: true, data, message };
}

function outputResult(data, raw, meta = {}) {
  if (raw) { console.log(JSON.stringify(data, null, 2)); return; }
  console.log(JSON.stringify({ success: true, data, ...meta }));
}

function outputError(error, raw, details = {}) {
  if (raw) { console.error(error.message); return; }
  console.log(JSON.stringify({ success: false, error: error.name || 'Error', message: error.message, ...details }));
}

module.exports = { createErrorResult, createSuccessResult, outputResult, outputError };
