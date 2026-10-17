const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getDiagnosticExcerpt } = require('./downloader');

test('diagnostic extraction preserves CR-delimited transfer errors without stack traces or signed URLs', () => {
  const output = [
    '[debug] ignored line',
    '[download] Got error: 18930 bytes read, 123456 more expected. Giving up after 3 retries',
    'File "C:\\app\\yt_dlp\\downloader.py", line 3570, in download',
    'https://cdn.example/video?token=secret'
  ].join('\r');

  const details = getDiagnosticExcerpt(output);

  assert.match(details, /18930 bytes read, 123456 more expected/);
  assert.doesNotMatch(details, /yt_dlp|cdn\.example|secret|\[debug\]/);
});
