// SPDX-License-Identifier: GPL-3.0-only
// End-to-end smoke test against a real Jellyfin server with the plugin installed.
// Fixture (see setup.sh): Alice/alicepw, Bob/bobpw, Kid (no password) visible on the login
// screen, Hidden hidden. Usage: node e2e.js [layout]   env: JF_URL, CHROMIUM, FIREFOX (path to a
// Playwright Firefox build: run in Gecko instead), OLD_ENGINE, SCREENSHOTS
const { chromium, firefox } = require('playwright-core');
const B = process.env.JF_URL || 'http://127.0.0.1:8096';
const out = process.env.SCREENSHOTS || '.';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const browser = process.env.FIREFOX
    ? await firefox.launch({ executablePath: process.env.FIREFOX })
    : await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const bad = [];
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.request().method() + ' ' + r.url().replace(B, '')); });
  page.on('console', m => { if ((m.type() === 'error' && !m.text().startsWith('Failed to load resource')) || (m.type() === 'warning' && m.text().includes('[WhoIsWatching]'))) errors.push(m.text()); });
  const notes = [];
  page.on('console', m => { if (m.type() === 'info' && m.text().startsWith('[WhoIsWatching]')) notes.push(m.text()); });
  const auths = [];
  page.on('request', r => { if (/authenticatebyname/i.test(r.url())) auths.push(r.postData()); });
  const layout = process.argv[2]; // e.g. desktop-legacy, tv; default: the server's default layout
  if (layout) await page.addInitScript(l => localStorage.setItem('layout', l), layout);
  // OLD_ENGINE=1: run everything without <dialog>, replaceChildren and createImageBitmap, like older
  // Safari, WebViews and Jellyfin Media Player's Chromium, so the fallbacks are exercised.
  if (process.env.OLD_ENGINE) await page.addInitScript(() => { delete window.HTMLDialogElement; delete Element.prototype.replaceChildren; delete window.createImageBitmap; });
  await page.goto(B + '/web/');
  await page.waitForFunction(() => window.ApiClient);
  await page.evaluate(() => window.ApiClient.authenticateUserByName('Alice', 'alicepw'));
  await page.goto(B + '/web/#/home');
  const avatar = page.locator('.headerUserButton, [aria-controls="app-user-menu"]').locator('visible=true').first();
  await avatar.waitFor({ timeout: 30000 });
  const me = () => page.evaluate(() => window.ApiClient.getCurrentUser().then(u => u.Name));
  const aliceToken = await page.evaluate(() => window.ApiClient.accessToken());
  const auth = token => ({ Authorization: `MediaBrowser Token="${token}"` });
  const signIn = async (name, pw, device) => (await (await fetch(B + '/Users/AuthenticateByName', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `MediaBrowser Client="e2e", Device="e2e", DeviceId="${device}", Version="1"` }, body: JSON.stringify({ Username: name, Pw: pw }) })).json()).AccessToken;
  const adminToken = await signIn('Alice', 'alicepw', 'e2e-admin');
  const config = c => fetch(B + '/Plugins/2d627493-2b57-432a-b238-c22aaf9fd609/Configuration', { method: 'POST', headers: { ...auth(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
  const defaults = { BrandText: 'Jellyfin', BrandColor: '#AA5CC3', BrandSize: 40, BrandPosition: 'TopLeft' };
  await config(defaults);
  const brand = () => page.$eval('.wiw-brand', el => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return { text: el.hidden ? '' : el.textContent, color: c.color, size: c.fontSize, base: getComputedStyle(el.parentNode).fontSize, left: Math.round(r.left), right: Math.round(innerWidth - r.right), top: Math.round(r.top) }; });
  const remembered = () => page.evaluate(() => JSON.parse(localStorage.getItem('whoiswatching-remembered-' + window.ApiClient.serverId()) || '{}'));

  errors.length = 0; // ignore the anonymous bootstrap before sign-in
  // pressing the avatar already loads the profiles, so the picker opens as the click lands
  let profileLoads = 0;
  page.on('request', r => { if (/Users\/Public/i.test(r.url())) profileLoads++; });
  await avatar.hover();
  await page.mouse.down();
  await page.waitForTimeout(300);
  const whilePressed = profileLoads;
  await page.mouse.up();
  await page.waitForSelector('.wiw[open]');
  ok(whilePressed === 1 && profileLoads === 1, `pressing the avatar preloads the profiles (${whilePressed} while pressed, ${profileLoads} in all)`);
  const names = await page.$$eval('.wiw-grid .wiw-name', els => els.map(e => e.textContent));
  ok(JSON.stringify(names) === '["Alice","Bob","Kid"]', 'grid shows public users only: ' + names);
  ok(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Alice, current profile', 'focus starts on current profile');
  await page.waitForTimeout(400); await page.screenshot({ path: out + '/' + (layout || 'default') + '-1-grid.png' });
  ok(await page.waitForFunction(() => { const i = document.querySelector('.wiw-grid button[aria-label="Bob"] img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).then(() => true, () => false), 'profile avatar image loads');
  await page.keyboard.press('ArrowRight');
  ok(await page.evaluate(() => document.activeElement.textContent.endsWith('Bob')), 'ArrowRight moves to Bob');
  await page.keyboard.press('ArrowDown');
  ok(await page.evaluate(() => document.activeElement.dataset.action) === 'manage', 'ArrowDown moves to Manage profiles');
  await page.keyboard.press('ArrowRight');
  ok(await page.evaluate(() => document.activeElement.dataset.action) === 'account', 'ArrowRight moves to the gear (Account settings)');
  ok(await page.$eval('[data-action=account]', b => b.getAttribute('aria-label') === 'Account settings' && !!b.querySelector('svg')), 'Account settings is a gear icon');
  await page.keyboard.press('Escape');
  ok(!(await page.$('.wiw[open]')), 'Escape closes');

  // brand text from the plugin settings: by default "Jellyfin" in Jellyfin's purple, top left
  await avatar.click();
  await page.waitForSelector('.wiw[open]');
  let b = await brand();
  // The brand size is pixels at 1080p (a 16px base) and scales with the picker.
  const scaled = (b, px) => Math.abs(parseFloat(b.size) - px * parseFloat(b.base) / 16) < 0.1;
  ok(b.text === 'Jellyfin' && b.color === 'rgb(170, 92, 195)' && scaled(b, 40) && b.left < 60 && b.top < 60, 'default brand text: ' + JSON.stringify(b));
  ok(!(await page.$('.wiw-grid .wiw-pencil')), 'no pencils on the profile grid');

  // Manage profiles, like Netflix: pencils only in this mode; administrators may change every profile
  await page.click('[data-action=manage]');
  ok(await page.textContent('.wiw-pick .wiw-title') === 'Manage profiles' && (await page.$$('.wiw-grid .wiw-pencil')).length === 3, 'Manage profiles marks every profile for an administrator');
  const bobBefore = await page.$eval('.wiw-grid button[aria-label^="Bob"] img', i => i.src);
  await page.click('.wiw-grid button[aria-label^="Bob"]');
  await page.waitForSelector('.wiw-pictures:not([hidden]) .wiw-add');
  await page.waitForTimeout(300); await page.screenshot({ path: out + '/' + (layout || 'default') + '-4-pictures.png' });
  const photo = await page.screenshot({ clip: { x: 0, y: 0, width: 900, height: 500 } });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.wiw-add')]);
  await chooser.setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: photo });
  await page.waitForSelector('.wiw-confirm:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(300); await page.screenshot({ path: out + '/' + (layout || 'default') + '-5-confirm.png' });
  await page.click('[data-action=apply]');
  await page.waitForFunction(src => { const i = document.querySelector('.wiw-grid button[aria-label^="Bob"] img'); return !document.querySelector('.wiw-pick').hidden && i && i.src !== src && i.complete && i.naturalWidth > 0; }, bobBefore, { timeout: 15000 });
  const picture = await page.$eval('.wiw-grid button[aria-label^="Bob"] img', i => [i.naturalWidth, i.naturalHeight, i.src]);
  ok(picture[0] === picture[1] && picture[0] <= 512 && (await fetch(picture[2])).headers.get('content-type') === 'image/jpeg', 'added a picture to the gallery and gave it to Bob: ' + picture[0] + 'x' + picture[1]);
  ok(await page.textContent('.wiw-pick .wiw-title') === 'Manage profiles', 'back on Manage profiles after the change');

  // the gallery keeps pictures: Kid picks the same one without uploading; Not yet goes back
  await page.click('.wiw-grid button[aria-label^="Kid"]');
  await page.waitForSelector('.wiw-pictures:not([hidden]) .wiw-tile[data-id]');
  const kept = (await page.$$('.wiw-gallery .wiw-tile[data-id]')).length;
  await page.click('.wiw-gallery .wiw-tile[data-id]');
  await page.click('.wiw-confirm [data-action=back]');
  ok(await page.isVisible('.wiw-gallery') && !(await page.isVisible('.wiw-confirm')), 'Not yet returns to the pictures');
  await page.click('.wiw-gallery .wiw-tile[data-id]');
  await page.click('[data-action=apply]');
  await page.waitForFunction(() => { const i = document.querySelector('.wiw-grid button[aria-label^="Kid"] img'); return !document.querySelector('.wiw-pick').hidden && i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  ok(kept >= 1, 'Kid got a picture from the shared gallery without uploading (' + kept + ' kept)');
  await page.keyboard.press('Escape');
  ok(await page.textContent('.wiw-pick .wiw-title') === 'Who’s watching?', 'Escape leaves Manage profiles');
  await page.keyboard.press('Escape');

  // brand text settings: text, colour, size and position
  await config({ BrandText: 'Family TV', BrandColor: '#FF8800', BrandSize: 56, BrandPosition: 'TopRight' });
  await avatar.click();
  await page.waitForSelector('.wiw[open]');
  b = await brand();
  ok(b.text === 'Family TV' && b.color === 'rgb(255, 136, 0)' && scaled(b, 56) && b.right < 150 && b.left > 300, 'custom brand text: ' + JSON.stringify(b));
  await config(defaults);
  await page.keyboard.press('Escape');

  // dashboard settings page: saves the brand text and deletes gallery pictures
  await page.goto(B + '/web/#/configurationpage?name=WhoIsWatching');
  await page.waitForFunction(() => { const t = document.querySelector('#wiwBrandText'); return t && t.value === 'Jellyfin'; }, null, { timeout: 30000 });
  await page.waitForSelector('#wiwGallery .wiwDelete');
  await page.fill('#wiwBrandText', 'Saved here');
  await page.click('#wiwConfigForm button[type=submit]');
  const saved = await page.waitForFunction(() => window.ApiClient.getJSON(window.ApiClient.getUrl('WhoIsWatching/Settings')).then(s => s.Text === 'Saved here'), null, { timeout: 10000 }).then(() => true, () => false);
  const listed = (await page.$$('#wiwGallery .wiwDelete')).length;
  await page.click('#wiwGallery .wiwDelete');
  const deleted = await page.waitForFunction(n => document.querySelectorAll('#wiwGallery .wiwDelete').length === n - 1, listed, { timeout: 10000 }).then(() => true, () => false);
  ok(saved && deleted, `dashboard page saves the brand text (${saved}) and deletes pictures (${deleted})`);
  await config(defaults);
  await page.goto(B + '/web/#/home');
  await avatar.waitFor({ timeout: 30000 });

  // the picker follows the theme, custom CSS included: the gear grows and takes its accent on hover
  const theme = await page.addStyleTag({ content: '.button-submit{background:rgb(255, 0, 128)!important}' });
  await avatar.click();
  await page.hover('[data-action=account]');
  await page.waitForTimeout(400);
  ok(await page.$eval('[data-action=account]', b => getComputedStyle(b).color === 'rgb(255, 0, 128)' && getComputedStyle(b).transform.startsWith('matrix(1.25')), 'gear hover follows a custom theme accent');
  await theme.evaluate(el => el.remove());

  // wrong password keeps current session
  await page.click('.wiw-grid button[aria-label="Bob"]');
  await page.waitForSelector('.wiw-auth:not([hidden]) .wiw-input:focus');
  ok(await page.isVisible('.wiw-remember'), 'Remember on this device offered for Bob');
  await page.fill('.wiw-input', 'nope');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.wiw-auth .wiw-error').textContent);
  ok((await page.textContent('.wiw-auth .wiw-error')).startsWith('Couldn’t sign in'), 'wrong password shows generic error');
  ok(await page.inputValue('.wiw-input') === '', 'password field cleared');
  ok(await me() === 'Alice', 'still Alice after failure');
  await page.waitForTimeout(400); await page.screenshot({ path: out + '/' + (layout || 'default') + '-2-auth-error.png' });
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => !document.querySelector('.wiw-pick').hidden && document.activeElement.textContent.endsWith('Bob')), 'Escape returns to grid, focus on Bob');

  // a tampered passwordless hint (not an array) is ignored: no blank attempt, password step shown
  const hint = await page.evaluate(async () => {
    const bob = (await window.ApiClient.getJSON(window.ApiClient.getUrl('Users/Public'))).find(u => u.Name === 'Bob');
    const key = 'whoiswatching-passwordless-' + window.ApiClient.serverId();
    localStorage.setItem(key, JSON.stringify('x' + bob.Id));
    return key;
  });
  const attempts = auths.length;
  await page.click('.wiw-grid button[aria-label="Bob"]');
  await page.waitForSelector('.wiw-auth:not([hidden]) .wiw-input:focus', { timeout: 5000 });
  ok(auths.length === attempts, 'tampered passwordless hint ignored: ' + (auths.length - attempts) + ' blank attempts');
  await page.keyboard.press('ArrowDown');
  ok(await page.evaluate(() => document.activeElement.classList.contains('wiw-remember')), 'ArrowDown from the password reaches Remember');
  if (layout === 'tv') {
    await page.keyboard.press('Enter');
    ok(await page.isChecked('.wiw-remember'), 'TV: OK key ticks Remember instead of submitting');
  }
  await page.evaluate(key => localStorage.removeItem(key), hint);
  await page.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) {
    await page.click('.wiw-grid button[aria-label="Bob"]');
    await page.keyboard.press('Escape');
  }
  ok(await page.evaluate(() => document.querySelector('.wiw').hasAttribute('open') && !document.querySelector('.wiw-pick').hidden), 'Escape keeps returning to the grid, not closing the picker');

  // correct password switches and revokes old token
  await page.click('.wiw-grid button[aria-label="Bob"]');
  await page.fill('.wiw-input', 'bobpw');
  await page.check('.wiw-remember');
  await page.focus('.wiw-input');
  await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
  await avatar.waitFor({ timeout: 30000 });
  await page.waitForFunction(() => window.ApiClient && window.ApiClient.getCurrentUserId());
  ok(await me() === 'Bob', 'switched to Bob');
  const bobId = await page.evaluate(() => window.ApiClient.getCurrentUserId());
  const bobToken = await page.evaluate(() => window.ApiClient.accessToken());
  ok((await remembered())[bobId] === bobToken, 'Bob remembered on this device (his token)');
  ok(!page.url().includes('#') || page.url().includes('home'), 'landed on home: ' + page.url());
  const r = await fetch(B + '/Users/Me', { headers: { Authorization: `MediaBrowser Token="${aliceToken}"` } });
  ok(r.status === 401, 'previous (Alice) token revoked: ' + r.status);
  ok(!JSON.stringify(await page.evaluate(() => ({ ...localStorage }))).includes('bobpw'), 'no password in localStorage');

  // passwordless profile: blank password, then remembered for one-click
  await avatar.click();
  await page.click('.wiw-grid button[aria-label="Kid"]');
  await Promise.all([page.waitForEvent('load'), page.click('.wiw-auth button[type=submit]')]);
  await avatar.waitFor({ timeout: 30000 });
  ok(await me() === 'Kid', 'switched to Kid with blank password');
  ok((await fetch(B + '/Users/Me', { headers: auth(bobToken) })).status === 200, 'leaving remembered Bob keeps his session');
  await avatar.click();
  await page.click('.wiw-grid button[aria-label="Alice"]');
  ok(!(await page.isVisible('.wiw-remember')), 'administrators are never remembered');
  await page.fill('.wiw-input', 'alicepw');
  await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
  await avatar.waitFor({ timeout: 30000 });
  ok(await me() === 'Alice', 'back to Alice');
  await avatar.click();
  await Promise.all([page.waitForEvent('load'), page.click('.wiw-grid button[aria-label="Kid"]')]);
  await avatar.waitFor({ timeout: 30000 });
  ok(await me() === 'Kid', 'Kid switched in one click (remembered passwordless)');

  // remembered profile: one click, no password sent
  let sent = auths.length;
  await avatar.click();
  await Promise.all([page.waitForEvent('load'), page.click('.wiw-grid button[aria-label="Bob"]')]);
  await avatar.waitFor({ timeout: 30000 });
  ok(await me() === 'Bob' && auths.length === sent, 'remembered Bob opens in one click without a password');

  // a remembered session that has ended (password changed, signed out) asks for the password again
  await avatar.click();
  await Promise.all([page.waitForEvent('load'), page.click('.wiw-grid button[aria-label="Kid"]')]);
  await avatar.waitFor({ timeout: 30000 });
  await fetch(B + '/Sessions/Logout', { method: 'POST', headers: auth(bobToken) });
  sent = auths.length;
  await avatar.click();
  await page.click('.wiw-grid button[aria-label="Bob"]');
  await page.waitForSelector('.wiw-auth:not([hidden]) .wiw-input:focus', { timeout: 10000 });
  ok(auths.length === sent && await page.isChecked('.wiw-remember'), 'ended session asks for the password, still set to remember');
  await page.fill('.wiw-input', 'bobpw');
  await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
  await avatar.waitFor({ timeout: 30000 });
  ok(await me() === 'Bob' && (await remembered())[bobId] === await page.evaluate(() => window.ApiClient.accessToken()), 'Bob remembered again');

  // a non-administrator manages only their own profile, and may add pictures
  await avatar.click();
  await page.click('[data-action=manage]');
  const marks = await page.$$eval('.wiw-grid .wiw-profile', els => els.map(e => e.getAttribute('aria-label') + (e.getAttribute('aria-disabled') ? ' (no)' : '')));
  ok((await page.$$('.wiw-grid .wiw-pencil')).length === 1 && marks.includes('Bob, current profile, change picture'), 'Bob manages only his own profile: ' + marks.join('; '));
  await page.click('.wiw-grid button[aria-label^="Bob"]');
  ok(await page.waitForSelector('.wiw-pictures:not([hidden]) .wiw-add', { timeout: 5000 }).then(() => true, () => false), 'Bob may add pictures');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
  ok(!(await page.$('.wiw[open]')), 'Escape steps back out of the pictures, Manage profiles, then the picker');

  // gallery API: sign-in to list, images only, 1 MB cap, admins delete, adding needs "manage own preferences"
  const bobApi = await signIn('Bob', 'bobpw', 'e2e-bob');
  const post = (token, body) => fetch(B + '/WhoIsWatching/Images', { method: 'POST', headers: { ...auth(token), 'Content-Type': 'image/jpeg' }, body });
  const added = await post(bobApi, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]));
  const addedId = added.ok ? (await added.json()).Id : '';
  const served = await fetch(B + '/WhoIsWatching/Images/' + addedId);
  const kidPolicy = (await (await fetch(B + '/Users', { headers: auth(adminToken) })).json()).find(u => u.Name === 'Kid');
  await fetch(B + `/Users/${kidPolicy.Id}/Policy`, { method: 'POST', headers: { ...auth(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...kidPolicy.Policy, EnableUserPreferenceAccess: false }) });
  const kidApi = await signIn('Kid', '', 'e2e-kid-api');
  const rules = {
    anonymousList: (await fetch(B + '/WhoIsWatching/Images')).status === 401,
    notAnImage: (await post(bobApi, Buffer.from('<svg onload=alert(1)>'))).status === 400,
    pngRefused: (await post(bobApi, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).status === 400,
    tooBig: (await post(bobApi, Buffer.alloc(1024 * 1024 + 1, 0xff))).status === 413,
    added: added.status === 200,
    served: served.headers.get('content-type') === 'image/jpeg' && served.headers.get('x-content-type-options') === 'nosniff',
    noPreferences: (await post(kidApi, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).status === 403,
    userCantDelete: (await fetch(B + '/WhoIsWatching/Images/' + addedId, { method: 'DELETE', headers: auth(bobApi) })).status === 403,
    adminDeletes: (await fetch(B + '/WhoIsWatching/Images/' + addedId, { method: 'DELETE', headers: auth(adminToken) })).status === 204,
    noTraversal: (await fetch(B + '/WhoIsWatching/Images/..%2F..%2Fsystem.xml')).status === 404
  };
  await fetch(B + `/Users/${kidPolicy.Id}/Policy`, { method: 'POST', headers: { ...auth(adminToken), 'Content-Type': 'application/json' }, body: JSON.stringify(kidPolicy.Policy) });
  ok(Object.values(rules).every(Boolean), 'gallery API rules: ' + JSON.stringify(rules));

  // if the picker can't be shown, the avatar keeps its original action
  await page.evaluate(() => { window.imageUrl = window.ApiClient.getUserImageUrl; window.ApiClient.getUserImageUrl = () => { throw new Error('test'); }; });
  await avatar.click();
  await page.waitForTimeout(1000);
  ok(!(await page.$('.wiw[open]')) && (page.url().includes('mypreferencesmenu') || await page.locator('#app-user-menu .MuiPaper-root').isVisible()), 'picker failure falls back to original action: ' + page.url());
  await page.evaluate(() => { window.ApiClient.getUserImageUrl = window.imageUrl; });
  errors.splice(0, errors.length, ...errors.filter(e => !e.includes('could not show profiles')));
  await page.keyboard.press('Escape');
  await page.goto(B + '/web/#/home');
  await avatar.waitFor();

  // account settings passes through to the original button action
  await avatar.click();
  await page.click('[data-action=account]');
  await page.waitForTimeout(1000);
  ok(page.url().includes('mypreferencesmenu') || await page.locator('#app-user-menu .MuiPaper-root').isVisible(), 'Account settings runs original action: ' + page.url());
  await page.keyboard.press('Escape');
  await page.goto(B + '/web/#/home');
  await avatar.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await avatar.click();
  await page.waitForSelector('.wiw[open]');
  await page.waitForTimeout(400); await page.screenshot({ path: out + '/' + (layout || 'default') + '-3-mobile.png' });

  // scales with the screen: profiles are 4/3 as big at 1440p and twice as big at 4K as at 1080p,
  // and nothing overflows sideways at any size
  const measure = async (width, height) => {
    await page.setViewportSize({ width, height });
    return page.evaluate(() => { const d = document.querySelector('.wiw'); return { tile: document.querySelector('.wiw-grid .wiw-profile').getBoundingClientRect().width, fits: d.scrollWidth <= d.clientWidth }; });
  };
  const sizes = [await measure(1920, 1080), await measure(2560, 1440), await measure(3840, 2160), await measure(390, 844), await measure(1366, 768)];
  await page.screenshot({ path: out + '/' + (layout || 'default') + '-6-1366.png' });
  await measure(2560, 1440); await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/' + (layout || 'default') + '-7-1440p.png' });
  ok(Math.abs(sizes[1].tile / sizes[0].tile - 4 / 3) < 0.02 && Math.abs(sizes[2].tile / sizes[0].tile - 2) < 0.02 && sizes.every(x => x.fits),
    'picker scales with the screen: ' + sizes.map(x => Math.round(x.tile) + (x.fits ? '' : ' (overflows)')).join(' / ') + 'px');
  ok(JSON.stringify(bad) === '["401 POST /Users/authenticatebyname","401 GET /Users/Me"]', 'only HTTP errors are the wrong password and the ended session: ' + bad.join(', '));
  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  ok(notes.some(n => /^\[WhoIsWatching\] \d+(\.\d+){3} loaded$/.test(n)), 'console says which version loaded: ' + notes[0]);
  ok(!process.env.OLD_ENGINE || await page.evaluate(() => document.querySelector('.wiw').tagName === 'DIV'), 'old engine: the <div> stand-in was used');

  // signing out of Jellyfin forgets remembered profiles and ends their sessions
  const kidId = await page.evaluate(async () => (await window.ApiClient.getJSON(window.ApiClient.getUrl('Users/Public'))).find(u => u.Name === 'Kid').Id);
  const kidToken = await signIn('Kid', '', 'e2e-kid');
  await page.evaluate(([id, token]) => { const key = 'whoiswatching-remembered-' + window.ApiClient.serverId(); localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)), [id]: token })); }, [kidId, kidToken]);
  await page.evaluate(() => window.ApiClient.logout());
  await page.waitForTimeout(500);
  ok(JSON.stringify(await remembered()) === '{}' && (await fetch(B + '/Users/Me', { headers: auth(kidToken) })).status === 401, 'signing out forgets remembered profiles and ends their sessions');
  await browser.close();
})().catch(e => { console.log('FAIL exception ' + e.message); process.exit(1); });
