const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildDownloadPlans } = require('./formatPolicy');

test('Bilibili fallback keeps the selected height and uses separate DASH streams', () => {
  const plans = buildDownloadPlans(
    'https://www.bilibili.com/video/BV1CYhyz4Ea2/?p=3',
    '360p'
  );

  assert.equal(plans.length, 3);
  assert.equal(plans[0].format, 'bestvideo[height<=360]+bestaudio/best[height<=360]');
  assert.equal(plans[1].format, plans[0].format);
  assert.match(plans[2].format, /bestvideo\[height<=360\]\[vcodec\^=hev1\]\+bestaudio/);
  assert.ok(plans[0].args.includes('--retries'));
  assert.ok(plans[1].args.includes('--http-chunk-size'));
  assert.ok(plans[1].args.includes('10M'));
  assert.ok(plans.every(plan => plan.format.includes('[height<=360]')));
});

test('unbounded best-format fallback is never emitted', () => {
  const plans = buildDownloadPlans('https://www.bilibili.com/video/BV1CYhyz4Ea2/?p=3', '360p');

  assert.ok(plans.every(plan => !plan.format.trim().endsWith('best')));
  assert.ok(plans.every(plan => !plan.format.includes('/best')) || plans.every(plan => plan.format.includes('[height<=')));
});

test('non-Bilibili fallbacks also retain the requested maximum resolution', () => {
  const plans = buildDownloadPlans('https://example.com/video', '480p');

  assert.equal(plans.length, 2);
  assert.ok(plans.every(plan => plan.format.includes('[height<=480]')));
});
