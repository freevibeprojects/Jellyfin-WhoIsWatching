// SPDX-License-Identifier: GPL-3.0-only
// Who's Watching: "Who's watching?" profile switcher for Jellyfin Web.
//
// Jellyfin surface this depends on (keep this list current when Jellyfin changes):
//   - window.ApiClient: getCurrentUserId, getCurrentUser, getJSON, getUrl, getUserImageUrl,
//     accessToken, authenticateUserByName (the same call the login page makes); optionally
//     onAuthenticated (remembered profiles), logout (wrapped to forget them), uploadUserImage
//   - GET /Users/Public (the login screen's user list), GET /Users/Me, POST /Sessions/Logout
//   - AVATAR_SELECTOR below, and the theme's .button-submit colour (accent)
//   - this plugin's GET /WhoIsWatching/Settings (brand text) and /WhoIsWatching/Images (the shared
//     picture gallery); a chosen picture is applied with ApiClient.uploadUserImage
// Jellyfin 12 never tells clients whether a user has a password (UserDto.HasPassword is always
// true), so every profile goes through the password step, where blank is allowed, exactly like
// the login page. After a blank password works once, this browser remembers that profile as
// passwordless and switches to it in one click. That hint is a user ID, never a secret.
// A profile can also be remembered on this device: its Jellyfin access token is kept (never the
// password), like Jellyfin's own "Remember me", so it opens in one click. Administrators never are.
// When any of it is missing, the avatar button keeps its normal behaviour.
(() => {
    'use strict';

    // The classic header's user button, and the newer (MUI) app bar's user menu button.
    const AVATAR_SELECTOR = '.headerUserButton, [aria-controls="app-user-menu"]';
    const API_METHODS = ['getCurrentUserId', 'getCurrentUser', 'getJSON', 'getUrl', 'getUserImageUrl',
        'accessToken', 'authenticateUserByName', 'serverId'];

    const TEXT = {
        title: 'Who’s watching?',
        account: 'Account settings',
        close: 'Close',
        password: 'Password',
        signIn: 'Sign in',
        back: 'Back',
        passwordHint: 'Leave empty if this profile has no password.',
        remember: 'Remember on this device',
        rememberHint: 'Anyone using this device can then open this profile without the password.',
        manage: 'Manage profiles',
        done: 'Done',
        picture: 'change picture',
        choosePicture: 'Choose a profile picture',
        addPicture: 'Add a picture',
        galleryPicture: 'Picture',
        noPictures: 'No pictures yet.',
        confirmPicture: 'Change profile picture?',
        currentPicture: 'Current',
        newPicture: 'New',
        notYet: 'Not yet',
        letsDoIt: 'Let’s do it',
        current: 'current profile',
        failed: 'Couldn’t sign in. Check the password and try again.',
        offline: 'Couldn’t reach the server. Try again.',
        pictureFailed: 'Couldn’t change the picture. Try another image.'
    };

    const PASSWORDLESS_KEY = 'whoiswatching-passwordless-';
    const REMEMBERED_KEY = 'whoiswatching-remembered-';
    const COLORS = ['#00838f', '#7b1fa2', '#c62828', '#2e7d32', '#ef6c00', '#3949ab', '#ad1457', '#5d4037'];
    // Material icons (Apache 2.0): close, settings, edit, add, arrow.
    const ICON_CLOSE = 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';
    const ICON_SETTINGS = 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z';
    const ICON_EDIT = 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z';
    const ICON_ADD = 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z';
    const ICON_ARROW = 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z';

    // --wiw-accent and --wiw-on-accent are set from the current theme each time the picker opens.
    // Plain values come before modern ones (clamp, max, env) so older engines (Jellyfin Media Player's
    // Chromium, older Safari and webOS) keep a working layout; .wiw-nogap stands in for flexbox gap.
    const CSS = `
.wiw{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;width:100%;height:100%;max-width:none;max-height:none;margin:0;border:0;padding:16px;
 padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));
 box-sizing:border-box;overflow:auto;background:var(--jf-palette-background-default,#101010);
 color:var(--jf-palette-text-primary,#fff);font:inherit;animation:wiw-in .18s ease-out}
.wiw[open]{display:flex}
.wiw:not([open]){display:none}
.wiw::backdrop{background:var(--jf-palette-background-default,#101010)}
.wiw[aria-busy=true]{cursor:progress}
.wiw-panel{margin:auto;display:flex;flex-direction:column;align-items:center;gap:2em;text-align:center;max-width:64em}
.wiw-panel[hidden]{display:none}
.wiw-title{margin:0;font-size:2.2rem;font-size:clamp(1.6rem,4vw,3rem);font-weight:500}
.wiw-grid{display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(1rem,2.5vw,2rem);margin:0;padding:0;list-style:none}
.wiw-profile{display:flex;flex-direction:column;align-items:center;gap:.7em;width:7.5rem;width:clamp(5.5rem,11vw,9rem);padding:0;border:0;
 background:none;color:var(--jf-palette-text-secondary,rgba(255,255,255,.7));font:inherit;cursor:pointer;outline:none}
.wiw-avatar{position:relative;display:grid;place-items:center;width:100%;aspect-ratio:1;overflow:hidden;border-radius:12%;
 background:var(--wiw-color);color:#fff;font-size:2.8rem;font-size:clamp(2rem,5vw,3.5rem);font-weight:500;
 box-shadow:0 0 0 0 transparent;transition:box-shadow .15s,transform .15s}
.wiw-avatar img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.wiw-profile[aria-current=true] .wiw-avatar{box-shadow:0 0 0 3px var(--wiw-accent,#00a4dc)}
button.wiw-profile:hover,button.wiw-profile:focus-visible{color:var(--jf-palette-text-primary,#fff)}
button.wiw-profile:hover .wiw-avatar,button.wiw-profile:focus-visible .wiw-avatar{box-shadow:0 0 0 3px var(--jf-palette-text-primary,#fff);transform:scale(1.04)}
.wiw-busy .wiw-avatar{animation:wiw-pulse 1s ease-in-out infinite}
.wiw-name{display:flex;align-items:center;gap:.3em;max-width:100%;font-size:1.05em;word-break:break-word;overflow-wrap:anywhere}
.wiw svg{width:1em;height:1em;flex:none;fill:currentColor}
.wiw-button{min-height:2.75em;padding:.5em 1.6em;border:1px solid var(--jf-palette-text-secondary,rgba(255,255,255,.7));border-radius:.3em;
 background:none;color:var(--jf-palette-text-secondary,rgba(255,255,255,.7));font:inherit;letter-spacing:.05em;cursor:pointer}
.wiw-button:hover,.wiw-button:focus-visible{border-color:var(--jf-palette-text-primary,#fff);color:var(--jf-palette-text-primary,#fff)}
.wiw-primary{border-color:transparent;background:var(--wiw-accent,#00a4dc);color:var(--wiw-on-accent,#fff)}
.wiw-primary:hover,.wiw-primary:focus-visible{border-color:var(--jf-palette-text-primary,#fff);color:var(--wiw-on-accent,#fff)}
.wiw-button:focus-visible,.wiw-close:focus-visible,.wiw-input:focus-visible,.wiw-remember:focus-visible{outline:2px solid var(--wiw-accent,#00a4dc);outline-offset:2px}
.wiw button:disabled,.wiw input:disabled{cursor:progress}
.wiw-close{position:absolute;top:12px;right:12px;top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));display:grid;place-items:center;
 width:2.75em;height:2.75em;padding:0;border:0;border-radius:50%;background:none;color:inherit;font-size:1.2em;cursor:pointer}
.wiw-close:hover{background:var(--jf-palette-action-hover,rgba(255,255,255,.08))}
.wiw-icon{display:grid;place-items:center;width:2em;height:2em;padding:0;border:0;border-radius:50%;background:none;
 color:var(--jf-palette-text-secondary,rgba(255,255,255,.7));font-size:1.6em;cursor:pointer;outline:none;transition:transform .2s,color .2s}
.wiw-icon:hover,.wiw-icon:focus-visible{color:var(--wiw-accent,#00a4dc);transform:scale(1.25)}
.wiw-brand{position:absolute;top:16px;left:24px;top:max(16px,env(safe-area-inset-top));left:max(24px,env(safe-area-inset-left));margin:0;
 font-size:var(--wiw-brand-size,40px);font-weight:700;line-height:1;white-space:nowrap}
.wiw-brand[data-position=TopCenter]{left:50%;transform:translateX(-50%)}
.wiw-brand[data-position=TopRight]{left:auto;right:4.5rem;right:calc(max(12px,env(safe-area-inset-right)) + 3.5rem)}
.wiw-brand[hidden]{display:none}
.wiw-branded{padding-top:calc(16px + var(--wiw-brand-size,40px) + 1rem);padding-top:calc(max(16px,env(safe-area-inset-top)) + var(--wiw-brand-size,40px) + 1rem)}
.wiw-pencil{position:absolute;top:0;left:0;width:100%;height:100%;display:grid;place-items:center;background:rgba(0,0,0,.55);color:#fff;font-size:.5em}
.wiw-pencil svg{padding:.35em;border:2px solid;border-radius:50%}
.wiw-new .wiw-avatar{background:var(--jf-palette-background-paper,#202020)}
.wiw-profile[aria-disabled=true]{opacity:.35;cursor:default}
.wiw-for .wiw-profile{width:5rem;font-size:.9rem}
.wiw-for .wiw-avatar{font-size:2rem}
.wiw-gallery{display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(.75rem,2vw,1.25rem);margin:0;padding:0;list-style:none}
.wiw-tile{position:relative;display:grid;place-items:center;width:6rem;width:clamp(4.5rem,9vw,7rem);aspect-ratio:1;padding:0;border:0;border-radius:12%;overflow:hidden;
 background:var(--jf-palette-background-paper,#202020);color:var(--jf-palette-text-secondary,rgba(255,255,255,.7));font-size:2.2em;cursor:pointer;outline:none;transition:box-shadow .15s,transform .15s}
.wiw-tile img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.wiw-tile:hover,.wiw-tile:focus-visible{box-shadow:0 0 0 3px var(--wiw-accent,#00a4dc);transform:scale(1.06)}
.wiw-add{border:2px dashed currentColor}
.wiw-add:hover,.wiw-add:focus-visible{color:var(--wiw-accent,#00a4dc)}
.wiw-compare{display:flex;align-items:center;gap:clamp(1rem,4vw,3rem)}
.wiw-compare figure{display:flex;flex-direction:column;align-items:center;gap:.7em;width:8rem;width:clamp(6rem,14vw,10rem);margin:0;color:var(--jf-palette-text-secondary,rgba(255,255,255,.7))}
.wiw-compare>svg{font-size:2em}
.wiw-auth .wiw-profile{cursor:default;color:var(--jf-palette-text-primary,#fff)}
.wiw-field{display:flex;flex-direction:column;align-items:stretch;gap:.4em;width:20em;max-width:80vw;text-align:start;color:var(--jf-palette-text-secondary,rgba(255,255,255,.7))}
.wiw-hint{font-size:.85em}
.wiw-input{box-sizing:border-box;width:100%;min-height:2.75em;padding:.5em .8em;border:1px solid var(--jf-palette-divider,rgba(255,255,255,.12));border-radius:.3em;
 background:var(--jf-palette-FilledInput-bg,#292929);color:var(--jf-palette-text-primary,#fff);font:inherit}
.wiw-check{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:.2em .6em;width:20em;max-width:80vw;margin-top:-1em;text-align:start;cursor:pointer}
.wiw-check[hidden]{display:none}
.wiw-check .wiw-hint{grid-column:2;color:var(--jf-palette-text-secondary,rgba(255,255,255,.7))}
.wiw-remember{width:1.2em;height:1.2em;margin:0;accent-color:var(--wiw-accent,#00a4dc)}
.wiw-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:1em}
.wiw-error{min-height:1.5em;margin:-1em 0 0;color:var(--jf-palette-error-light,#ef5350)}
@supports not (aspect-ratio:1/1){
 .wiw-profile{width:7.5rem}.wiw-profile .wiw-avatar{height:7.5rem}.wiw-for .wiw-profile{width:5rem}.wiw-for .wiw-avatar{height:5rem}
 .wiw-compare figure{width:8rem}.wiw-compare .wiw-avatar{height:8rem}.wiw-tile{width:6rem;height:6rem}}
.wiw-nogap .wiw-panel>*+*{margin-top:2em}
.wiw-nogap .wiw-grid>li,.wiw-nogap .wiw-gallery>li{margin:.6rem}
.wiw-nogap .wiw-profile>*+*,.wiw-nogap .wiw-compare figure>*+*{margin-top:.7em}
.wiw-nogap .wiw-field>*+*{margin-top:.4em}
.wiw-nogap .wiw-actions>*,.wiw-nogap .wiw-compare>*{margin:0 .5em}
@keyframes wiw-in{from{opacity:0;transform:scale(1.03)}}
@keyframes wiw-pulse{50%{opacity:.5}}
@media (prefers-reduced-motion:reduce){.wiw,.wiw-avatar,.wiw-busy .wiw-avatar,.wiw-icon,.wiw-tile{animation:none;transition:none}}
`;

    // Shown in the console so a device where the picker doesn't appear can be checked (F12, or
    // chrome://inspect for the Android app).
    const VERSION = ((document.currentScript && /[?&]v=([\d.]+)/.exec(document.currentScript.src)) || [])[1];
    console.info(`[WhoIsWatching] ${VERSION || ''} loaded`);

    let dialog;
    let pickPanel;
    let picturesPanel;
    let confirmPanel;
    let authPanel;
    let trigger;
    let pending; // { user, button } waiting for a password
    let profiles = []; // the listed users
    let managing = false; // "Manage profiles": picking a profile changes its picture
    let editing; // the user whose picture is being changed
    let chosen; // the gallery picture about to be applied
    const buttons = new Map(); // user ID -> profile button
    const colors = new Map(); // user ID -> avatar colour
    const watched = new WeakSet(); // ApiClients whose sign-out is watched
    let opening = false;
    let busy = false;
    let bypass = false;

    window.addEventListener('click', onAvatarClick, true);

    async function onAvatarClick(e) {
        // Any click may be the one that signs out (menus, settings page), so watch before it runs.
        watchSignOut(window.ApiClient);
        const button = !bypass && e.target instanceof Element && e.target.closest(AVATAR_SELECTOR);
        const api = window.ApiClient;
        if (!button) {
            return;
        }

        if (!api || !API_METHODS.every(m => typeof api[m] === 'function') || !api.getCurrentUserId()) {
            console.info('[WhoIsWatching] not signed in, or this Jellyfin Web lacks ApiClient methods; avatar left alone');
            return;
        }

        e.preventDefault();
        e.stopImmediatePropagation();
        if (opening || isOpen()) {
            return;
        }

        trigger = button;
        opening = true;
        let users = [];
        let settings = null;
        try {
            [users, settings] = await Promise.all([
                loadUsers(api),
                api.getJSON(api.getUrl('WhoIsWatching/Settings')).catch(() => null)
            ]);
        } catch (err) {
            console.warn('[WhoIsWatching] could not load profiles', err);
        } finally {
            opening = false;
        }

        // Nobody to switch to, or the picker can't be shown: behave exactly as if the plugin were not installed.
        try {
            if (users.length >= 2) {
                open(api, users, settings);
                return;
            }

            if (users.length) {
                console.info('[WhoIsWatching] no other profile is visible to this user (Dashboard \u2192 Users \u2192 Profile: '
                    + '"Hide this user from login screens"); avatar left alone');
            }
        } catch (err) {
            console.warn('[WhoIsWatching] could not show profiles', err);
        }

        passThrough();
    }

    // Re-run the avatar button's own action (settings page or user menu).
    function passThrough() {
        const target = trigger && trigger.isConnected ? trigger : document.querySelector(AVATAR_SELECTOR);
        if (!target) {
            return;
        }

        bypass = true;
        try {
            target.click();
        } finally {
            bypass = false;
        }
    }

    async function loadUsers(api) {
        // Same list and filters as the login screen: hidden, disabled, device- and network-restricted
        // users are already removed by the server.
        const users = await api.getJSON(api.getUrl('Users/Public'));
        const currentId = api.getCurrentUserId();
        if (!users.some(u => u.Id === currentId)) {
            // The signed-in user may be hidden from login screens; still show them as "you".
            users.unshift(await api.getCurrentUser());
        }

        return users;
    }

    function open(api, users, settings) {
        if (!dialog) {
            build();
        }

        managing = false;
        followTheme();
        showBrand(settings);
        render(api, users);
        showPick();
        showDialog();
        (pickPanel.querySelector('[aria-current]') || pickPanel.querySelector('.wiw-grid button')).focus();
    }

    function render(api, users) {
        profiles = users;
        // Colour follows the user ID, so it is stable; collisions move to the next free colour.
        colors.clear();
        for (const user of users) {
            let i = hash(user.Id) % COLORS.length;
            while (colors.size < COLORS.length && Array.from(colors.values()).includes(COLORS[i])) {
                i = (i + 1) % COLORS.length;
            }

            colors.set(user.Id, COLORS[i]);
        }

        const currentId = api.getCurrentUserId();
        buttons.clear();
        fill(pickPanel.querySelector('.wiw-grid'), ...users.map(user => {
            const li = document.createElement('li');
            const button = profileButton(api, user, user.Id === currentId);
            buttons.set(user.Id, button);
            li.append(button);
            return li;
        }));
        pickPanel.querySelector('.wiw-title').textContent = managing ? TEXT.manage : TEXT.title;
        const manage = pickPanel.querySelector('[data-action=manage]');
        manage.textContent = managing ? TEXT.done : TEXT.manage;
        manage.hidden = !users.some(user => canEdit(api, user));
        pickPanel.querySelector('[data-action=account]').hidden = managing;
    }

    // The administrator's brand text (plugin settings), in a corner like Netflix's logo.
    function showBrand(settings) {
        const brand = dialog.querySelector('.wiw-brand');
        brand.hidden = !(settings && settings.Text);
        dialog.classList.toggle('wiw-branded', !brand.hidden);
        if (!brand.hidden) {
            brand.textContent = settings.Text;
            brand.style.color = settings.Color;
            brand.dataset.position = settings.Position;
            dialog.style.setProperty('--wiw-brand-size', settings.Size + 'px');
        }
    }

    // The theme's accent colour, read from the page so the picker follows any theme, including
    // custom CSS: Jellyfin's primary button colour, else the theme variable, else Jellyfin blue.
    function followTheme() {
        const probe = document.createElement('button');
        probe.className = 'button-submit';
        probe.style.display = 'none';
        document.body.append(probe);
        const button = getComputedStyle(probe);
        const solid = button.backgroundColor !== 'rgba(0, 0, 0, 0)';
        const accent = solid ? button.backgroundColor : themeVariable('--jf-palette-primary-main');
        const onAccent = solid ? button.color : themeVariable('--jf-palette-primary-contrastText');
        probe.remove();
        dialog.style.setProperty('--wiw-accent', accent || '#00a4dc');
        dialog.style.setProperty('--wiw-on-accent', onAccent || '#fff');
    }

    function themeVariable(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function build() {
        const style = document.createElement('style');
        // Where :focus-visible is unknown (older Chromium, Safari before 15.4) the whole rule would be
        // dropped and remotes would show no highlight, so fall back to :focus.
        style.textContent = supportsSelector(':focus-visible') ? CSS : CSS.replace(/:focus-visible/g, ':focus');
        document.head.append(style);

        // A <div> stands in where <dialog> is missing (Safari before 15.4, old WebViews).
        dialog = document.createElement(window.HTMLDialogElement ? 'dialog' : 'div');
        dialog.className = 'wiw';
        dialog.classList.toggle('wiw-nogap', !supportsFlexGap());
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'wiw-title');
        // Static markup only; user-provided values are always set through textContent/attributes.
        dialog.innerHTML = `
<p class="wiw-brand" aria-hidden="true" hidden></p>
<button type="button" class="wiw-close" data-action="close" aria-label="${TEXT.close}">${icon(ICON_CLOSE)}</button>
<section class="wiw-panel wiw-pick">
 <h1 class="wiw-title" id="wiw-title">${TEXT.title}</h1>
 <ul class="wiw-grid"></ul>
 <p class="wiw-error" role="alert"></p>
 <div class="wiw-actions">
  <button type="button" class="wiw-button" data-action="manage">${TEXT.manage}</button>
  <button type="button" class="wiw-icon" data-action="account" aria-label="${TEXT.account}" title="${TEXT.account}">${icon(ICON_SETTINGS)}</button>
 </div>
</section>
<section class="wiw-panel wiw-pictures" hidden>
 <h1 class="wiw-title">${TEXT.choosePicture}</h1>
 <div class="wiw-for"></div>
 <ul class="wiw-gallery"></ul>
 <input class="wiw-file" type="file" accept="image/*" hidden>
 <p class="wiw-error" role="alert"></p>
 <button type="button" class="wiw-button" data-action="back">${TEXT.back}</button>
</section>
<section class="wiw-panel wiw-confirm" hidden>
 <h1 class="wiw-title">${TEXT.confirmPicture}</h1>
 <div class="wiw-compare"><figure class="wiw-old"></figure>${icon(ICON_ARROW)}<figure class="wiw-new"></figure></div>
 <p class="wiw-error" role="alert"></p>
 <div class="wiw-actions">
  <button type="button" class="wiw-button" data-action="back">${TEXT.notYet}</button>
  <button type="button" class="wiw-button wiw-primary" data-action="apply">${TEXT.letsDoIt}</button>
 </div>
</section>
<form class="wiw-panel wiw-auth" hidden>
 <div class="wiw-who"></div>
 <input class="wiw-username" type="text" autocomplete="username" hidden>
 <label class="wiw-field">${TEXT.password}<input class="wiw-input" type="password" autocomplete="current-password" aria-describedby="wiw-hint"><span class="wiw-hint" id="wiw-hint">${TEXT.passwordHint}</span></label>
 <label class="wiw-check"><input class="wiw-remember" type="checkbox" aria-describedby="wiw-remember-hint">${TEXT.remember}<span class="wiw-hint" id="wiw-remember-hint">${TEXT.rememberHint}</span></label>
 <p class="wiw-error" role="alert"></p>
 <div class="wiw-actions">
  <button type="button" class="wiw-button" data-action="back">${TEXT.back}</button>
  <button type="submit" class="wiw-button wiw-primary">${TEXT.signIn}</button>
 </div>
</form>`;
        pickPanel = dialog.querySelector('.wiw-pick');
        picturesPanel = dialog.querySelector('.wiw-pictures');
        confirmPanel = dialog.querySelector('.wiw-confirm');
        authPanel = dialog.querySelector('.wiw-auth');
        const file = picturesPanel.querySelector('.wiw-file');

        dialog.addEventListener('click', e => {
            const action = e.target instanceof Element && e.target.closest('[data-action]');
            if (!action || busy) {
                return;
            }

            const name = action.getAttribute('data-action');
            if (name === 'back') {
                back();
            } else if (name === 'manage') {
                setManaging(window.ApiClient, !managing);
            } else if (name === 'add') {
                file.click();
            } else if (name === 'apply') {
                applyPicture(window.ApiClient);
            } else {
                closeDialog();
                if (name === 'account') {
                    passThrough();
                }
            }
        });

        file.addEventListener('change', () => {
            const image = file.files[0];
            file.value = '';
            if (image) {
                addPicture(window.ApiClient, image);
            }
        });

        authPanel.addEventListener('submit', async e => {
            e.preventDefault();
            const input = authPanel.querySelector('.wiw-input');
            const password = input.value;
            input.value = '';
            const err = await switchTo(pending.user, password, authPanel.querySelector('.wiw-remember').checked);
            setError(failure(err));
            input.focus();
        });

        // Other close requests (such as Android's back gesture) also go back a step first, and
        // never close mid-request. Escape is handled in onKeyDown.
        dialog.addEventListener('cancel', e => {
            if (back()) {
                e.preventDefault();
            }
        });

        dialog.addEventListener('close', () => {
            authPanel.querySelector('.wiw-input').value = '';
            pending = null;
        });

        dialog.addEventListener('keydown', onKeyDown);
        // Without a real modal dialog, keep keyboard focus from wandering to the page behind.
        document.addEventListener('focusin', e => {
            if (isOpen() && !dialog.contains(e.target)) {
                (dialog.querySelector('.wiw-panel:not([hidden]) button') || dialog.querySelector('.wiw-close')).focus();
            }
        });
        document.body.append(dialog);
    }

    function isOpen() {
        return Boolean(dialog) && dialog.hasAttribute('open');
    }

    function showDialog() {
        if (dialog.showModal) {
            dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
    }

    function closeDialog() {
        if (dialog.close) {
            dialog.close();
        } else if (isOpen()) {
            dialog.removeAttribute('open');
            dialog.dispatchEvent(new Event('close'));
        }
    }

    // Element.replaceChildren needs Chrome 86 / Safari 14; append works far back.
    function fill(parent, ...nodes) {
        parent.textContent = '';
        parent.append(...nodes);
    }

    function supportsSelector(selector) {
        try {
            document.querySelector(selector);
            return true;
        } catch (err) {
            return false;
        }
    }

    // Flexbox gap needs Chrome 84 / Safari 14.1; a column with a 1px gap is 1px tall where it works.
    function supportsFlexGap() {
        const probe = document.createElement('div');
        probe.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute';
        probe.append(document.createElement('div'), document.createElement('div'));
        document.body.append(probe);
        const supported = probe.scrollHeight === 1;
        probe.remove();
        return supported;
    }

    function profileButton(api, user, isCurrent) {
        // While managing profiles, only profiles whose picture may be changed carry the pencil.
        const editable = managing && canEdit(api, user);
        const button = profile(api, user, 'button', editable);
        button.type = 'button';
        const label = [user.Name];
        if (isCurrent) {
            button.setAttribute('aria-current', 'true');
            label.push(TEXT.current);
        }

        if (editable) {
            label.push(TEXT.picture);
        } else if (managing) {
            button.setAttribute('aria-disabled', 'true');
        }

        button.setAttribute('aria-label', label.join(', '));
        button.addEventListener('click', () => {
            if (!managing) {
                select(api, user, button);
            } else if (editable && !busy) {
                openPictures(api, user);
            }
        });
        return button;
    }

    function profile(api, user, tag, pencil) {
        const el = document.createElement(tag);
        el.className = 'wiw-profile';
        const name = document.createElement('span');
        name.className = 'wiw-name';
        name.textContent = user.Name;
        el.append(avatar(api, user, pencil), name);
        return el;
    }

    function avatar(api, user, pencil) {
        const el = document.createElement('span');
        el.className = 'wiw-avatar';
        el.setAttribute('aria-hidden', 'true');
        // The initial, unless the pencil covers the picture.
        el.textContent = pencil ? '' : (Array.from((user.Name || '').trim())[0] || '?').toUpperCase();
        el.style.setProperty('--wiw-color', colors.get(user.Id));
        if (user.PrimaryImageTag) {
            const img = document.createElement('img');
            img.alt = '';
            img.decoding = 'async';
            img.onerror = () => img.remove();
            img.src = api.getUserImageUrl(user.Id, { type: 'Primary', tag: user.PrimaryImageTag, maxWidth: 320 });
            el.append(img);
        }

        if (pencil) {
            const mark = document.createElement('span');
            mark.className = 'wiw-pencil';
            mark.innerHTML = icon(ICON_EDIT);
            el.append(mark);
        }

        return el;
    }

    async function select(api, user, button) {
        if (busy) {
            return;
        }

        if (user.Id === api.getCurrentUserId()) {
            closeDialog();
            return;
        }

        // One click for profiles remembered on this device, or that signed in here with a blank
        // password before. Nothing else is ever tried, so a protected profile never loses lockout
        // attempts to a guess.
        const token = canRemember(api) && remembered(api)[user.Id];
        if (token || passwordless(api).includes(user.Id)) {
            button.classList.add('wiw-busy');
            const err = await switchTo(user, token ? null : '', Boolean(token));
            button.classList.remove('wiw-busy');
            // 401: the token was ended (password changed, signed out elsewhere) or a password was
            // added since, so ask for it. Anything else (access schedule, network) is only reported.
            if (err.status !== 401) {
                setError(failure(err));
                return;
            }

            forget(api, user.Id);
        }

        pending = { user, button };
        fill(authPanel.querySelector('.wiw-who'), profile(api, user, 'div'));
        authPanel.querySelector('.wiw-username').value = user.Name;
        authPanel.querySelector('.wiw-check').hidden = !canRemember(api) || isAdmin(user);
        authPanel.querySelector('.wiw-remember').checked = Boolean(token);
        show(authPanel);
        setError('');
        authPanel.querySelector('.wiw-input').focus();
    }

    function isAdmin(user) {
        return Boolean(user && user.Policy && user.Policy.IsAdministrator);
    }

    function canRemember(api) {
        return typeof api.onAuthenticated === 'function';
    }

    function me(api) {
        return profiles.find(user => user.Id === api.getCurrentUserId());
    }

    // Jellyfin's own rule: "Allow this user to manage their own preferences" (administrators always).
    // Administrators may also change anyone's picture. The server checks both again.
    function mayManageOwn(user) {
        return Boolean(user) && (isAdmin(user) || !user.Policy || user.Policy.EnableUserPreferenceAccess !== false);
    }

    function canEdit(api, user) {
        const current = me(api);
        return typeof api.uploadUserImage === 'function' && (isAdmin(current) || (user === current && mayManageOwn(current)));
    }

    function canAdd(api) {
        return mayManageOwn(me(api));
    }

    // This browser's per-server memory. A value of the wrong shape (tampered or corrupt) is ignored,
    // so it can't cause blank sign-in attempts or odd requests.
    function stored(api, key, empty) {
        try {
            const value = JSON.parse(localStorage.getItem(key + api.serverId()));
            return value && typeof value === 'object' && Array.isArray(value) === Array.isArray(empty) ? value : empty;
        } catch (err) {
            return empty;
        }
    }

    function store(api, key, value) {
        try {
            localStorage.setItem(key + api.serverId(), JSON.stringify(value));
        } catch (err) {
            // Storage unavailable (private mode): nothing is remembered and the password step shows.
        }
    }

    function passwordless(api) {
        return stored(api, PASSWORDLESS_KEY, []);
    }

    function rememberPasswordless(api, userId, isPasswordless) {
        const ids = passwordless(api).filter(id => id !== userId);
        if (isPasswordless) {
            ids.push(userId);
        }

        store(api, PASSWORDLESS_KEY, ids);
    }

    // Profiles remembered on this device: user ID -> that profile's access token, never a password.
    function remembered(api) {
        const tokens = {};
        for (const [id, token] of Object.entries(stored(api, REMEMBERED_KEY, {}))) {
            if (/^\w+$/.test(token)) {
                tokens[id] = token;
            }
        }

        return tokens;
    }

    // Forgets a profile on this device: its passwordless hint and its remembered token.
    function forget(api, userId) {
        rememberPasswordless(api, userId, false);
        const tokens = remembered(api);
        delete tokens[userId];
        store(api, REMEMBERED_KEY, tokens);
    }

    // Signing out of Jellyfin here (every sign-out path calls ApiClient.logout) also forgets every
    // remembered profile and ends its session.
    function watchSignOut(api) {
        if (!api || watched.has(api) || typeof api.logout !== 'function' || typeof api.serverId !== 'function') {
            return;
        }

        watched.add(api);
        const logout = api.logout;
        api.logout = function (...args) {
            const current = api.accessToken();
            for (const token of Object.values(remembered(api))) {
                if (token !== current) {
                    revoke(api, token);
                }
            }

            store(api, REMEMBERED_KEY, {});
            return logout.apply(this, args);
        };
    }

    function revoke(api, token) {
        return fetch(api.getUrl('Sessions/Logout'), {
            method: 'POST',
            headers: { Authorization: `MediaBrowser Token="${token}"` },
            credentials: 'omit',
            keepalive: true
        }).catch(err => console.warn('[WhoIsWatching] could not end a session', err));
    }

    function show(panel) {
        for (const el of dialog.querySelectorAll('.wiw-panel')) {
            el.hidden = el !== panel;
        }
    }

    function showPick() {
        show(pickPanel);
        authPanel.querySelector('.wiw-input').value = '';
        setError('');
        if (pending) {
            pending.button.focus();
            pending = null;
        }
    }

    // One message for every refusal, so the response never hints at why it was refused.
    function failure(err) {
        return err.status === 401 || err.status === 403 ? TEXT.failed : TEXT.offline;
    }

    // Resolves to the sign-in error, or never resolves because the page reloads. A null password
    // signs in with the profile's remembered token instead.
    async function switchTo(user, password, remember) {
        const api = window.ApiClient;
        const tokens = remembered(api);
        const previousId = api.getCurrentUserId();
        const previousToken = api.accessToken();
        setBusy(true);
        setError('');
        let keepPrevious;
        let result;
        try {
            // The previous profile stays signed in here only if it is remembered and not an administrator.
            keepPrevious = Boolean(tokens[previousId]) && !isAdmin(await api.getCurrentUser());
            // Jellyfin's own login call: on success the web client stores the new session exactly as
            // after a normal sign-in; on failure nothing about the current session changes.
            result = password === null
                ? await resume(api, user, tokens[user.Id])
                : await api.authenticateUserByName(user.Name, password);
        } catch (err) {
            setBusy(false);
            return err || {};
        }

        // The ID the server signed in, in case the name moved to another user since the list loaded.
        const userId = result.User.Id;
        delete tokens[previousId];
        delete tokens[userId];
        if (keepPrevious) {
            tokens[previousId] = previousToken;
        }

        if (remember && !isAdmin(result.User)) {
            tokens[userId] = result.AccessToken;
        }

        store(api, REMEMBERED_KEY, tokens);
        if (password !== null) {
            rememberPasswordless(api, userId, password === '');
        }

        // The server only replaces tokens of the *same* user on this device, so end the previous
        // profile's session explicitly instead of leaving a live token behind, unless it is remembered.
        if (!keepPrevious) {
            await revoke(api, previousToken);
        }

        // Full reload, without the old route: nothing the previous profile loaded (cached queries,
        // views, player state) survives into the new one.
        location.replace(location.pathname + location.search);
        return new Promise(() => {});
    }

    // Signs in with a remembered token the way Jellyfin Web does once a password is accepted. The
    // server still applies the user's policy (disabled, access schedule, remote access) to it.
    // Fails with 401 if the token was ended, or belongs to an administrator (it is ended then).
    async function resume(api, user, token) {
        const response = await fetch(api.getUrl('Users/Me'), {
            headers: { Authorization: `MediaBrowser Token="${token}"` },
            credentials: 'omit'
        });
        if (!response.ok) {
            throw { status: response.status };
        }

        const me = await response.json();
        if (me.Id !== user.Id || isAdmin(me)) {
            await revoke(api, token);
            throw { status: 401 };
        }

        const result = { User: me, AccessToken: token, ServerId: api.serverId() };
        await api.onAuthenticated(api, result);
        return result;
    }

    function setManaging(api, value) {
        managing = value;
        render(api, profiles);
        showPick();
        const listed = Array.from(buttons.values());
        const first = listed.find(button => !button.hasAttribute('aria-disabled'));
        (managing ? first : buttons.get(api.getCurrentUserId()) || first).focus();
    }

    // One step back: the password, confirmation and picture pages return to the page before, and
    // managing profiles ends. False when there is nothing left, so the dialog should close.
    function back() {
        if (busy) {
            return true;
        }

        if (!authPanel.hidden) {
            showPick();
        } else if (!confirmPanel.hidden) {
            show(picturesPanel);
            setError('');
            const tiles = Array.from(picturesPanel.querySelectorAll('.wiw-tile'));
            (tiles.find(tile => tile.dataset.id === chosen) || tiles[0] || picturesPanel.querySelector('[data-action=back]')).focus();
        } else if (!picturesPanel.hidden) {
            showPick();
            (buttons.get(editing.Id) || pickPanel.querySelector('[data-action=manage]')).focus();
        } else if (managing) {
            setManaging(window.ApiClient, false);
        } else {
            return false;
        }

        return true;
    }

    async function openPictures(api, user) {
        editing = user;
        fill(picturesPanel.querySelector('.wiw-for'), profile(api, user, 'div'));
        fill(picturesPanel.querySelector('.wiw-gallery'));
        show(picturesPanel);
        setError('');
        await loadGallery(api);
        (picturesPanel.querySelector('.wiw-tile') || picturesPanel.querySelector('[data-action=back]')).focus();
    }

    // The shared gallery: + first (adds a picture for everyone), then the pictures, newest first.
    async function loadGallery(api) {
        let ids = [];
        try {
            ids = await api.getJSON(api.getUrl('WhoIsWatching/Images'));
        } catch (err) {
            setError(TEXT.offline);
        }

        const tiles = ids.map((id, i) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'wiw-tile';
            tile.dataset.id = id;
            tile.setAttribute('aria-label', `${TEXT.galleryPicture} ${i + 1}`);
            tile.append(galleryImage(api, id));
            tile.addEventListener('click', () => choose(api, id));
            return tile;
        });
        if (canAdd(api)) {
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'wiw-tile wiw-add';
            add.setAttribute('data-action', 'add');
            add.setAttribute('aria-label', TEXT.addPicture);
            add.title = TEXT.addPicture;
            add.innerHTML = icon(ICON_ADD);
            tiles.unshift(add);
        }

        const items = tiles.map(tile => {
            const li = document.createElement('li');
            li.append(tile);
            return li;
        });
        if (!items.length) {
            const empty = document.createElement('li');
            empty.className = 'wiw-hint';
            empty.textContent = TEXT.noPictures;
            items.push(empty);
        }

        fill(picturesPanel.querySelector('.wiw-gallery'), ...items);
    }

    function galleryImage(api, id) {
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = api.getUrl('WhoIsWatching/Images/' + id);
        return img;
    }

    // Netflix's "Change profile icon?" step: current picture, arrow, new picture.
    function choose(api, id) {
        if (busy) {
            return;
        }

        chosen = id;
        const picture = document.createElement('span');
        picture.className = 'wiw-avatar';
        picture.append(galleryImage(api, id));
        fill(confirmPanel.querySelector('.wiw-old'), avatar(api, editing), caption(TEXT.currentPicture));
        fill(confirmPanel.querySelector('.wiw-new'), picture, caption(TEXT.newPicture));
        show(confirmPanel);
        setError('');
        confirmPanel.querySelector('[data-action=apply]').focus();
    }

    function caption(text) {
        const el = document.createElement('figcaption');
        el.textContent = text;
        return el;
    }

    // Copies the chosen gallery picture to the profile through Jellyfin's own user-image API, which
    // applies Jellyfin's permission checks.
    async function applyPicture(api) {
        setBusy(true);
        setError('');
        try {
            const response = await fetch(api.getUrl('WhoIsWatching/Images/' + chosen));
            if (!response.ok) {
                throw response;
            }

            await api.uploadUserImage(editing.Id, 'Primary', await response.blob());
            render(api, await loadUsers(api));
            setBusy(false);
            showPick();
            (buttons.get(editing.Id) || pickPanel.querySelector('[data-action=manage]')).focus();
        } catch (err) {
            setBusy(false);
            setError(TEXT.pictureFailed);
        }
    }

    // Adds a picture to the shared gallery, then offers it for this profile. It is cropped to a centred
    // square of at most 512 px, as JPEG, because Jellyfin serves profile pictures at their uploaded size.
    async function addPicture(api, file) {
        setBusy(true);
        setError('');
        let id;
        try {
            const image = await decode(file);
            const side = Math.min(image.width, image.height);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = Math.min(side, 512);
            const context = canvas.getContext('2d');
            context.fillStyle = '#303030'; // behind transparent images
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
            const response = await fetch(api.getUrl('WhoIsWatching/Images'), {
                method: 'POST',
                headers: { Authorization: `MediaBrowser Token="${api.accessToken()}"`, 'Content-Type': 'image/jpeg' },
                body: await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
            });
            if (!response.ok) {
                throw response;
            }

            id = (await response.json()).Id;
        } catch (err) {
            setError(TEXT.pictureFailed);
        }

        await loadGallery(api);
        setBusy(false);
        if (id) {
            choose(api, id);
        } else {
            picturesPanel.querySelector('.wiw-add').focus();
        }
    }

    // createImageBitmap needs Safari 15; an <img> works everywhere.
    function decode(file) {
        if (typeof createImageBitmap === 'function') {
            return createImageBitmap(file);
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('not an image'));
            };
            img.src = url;
        });
    }

    function setBusy(value) {
        busy = value;
        dialog.setAttribute('aria-busy', String(value));
        dialog.querySelectorAll('button, input').forEach(el => {
            el.disabled = value;
        });
    }

    function setError(message) {
        dialog.querySelectorAll('.wiw-error').forEach(el => {
            el.textContent = message;
        });
    }

    function onKeyDown(e) {
        // Keep Jellyfin's global shortcuts and TV navigation from acting behind the dialog.
        e.stopPropagation();

        // Escape and TV remotes' back key (webOS sends 461) go back a step, then close. Escape is
        // handled here rather than through the dialog's cancel event: Chrome lets a page cancel that
        // only a few times in a row, and then closes the whole dialog.
        if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack' || e.keyCode === 461) {
            e.preventDefault();
            if (!back()) {
                closeDialog();
            }

            return;
        }

        // TV remotes' OK key is Enter, which would submit the form instead of ticking the box.
        if (e.key === 'Enter' && e.target.classList.contains('wiw-remember')
            && document.documentElement.classList.contains('layout-tv')) {
            e.preventDefault();
            e.target.click();
            return;
        }

        // Left/Right stay with the password field's cursor; Up/Down move between controls.
        if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)
            || (e.target.type === 'password' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
            return;
        }

        const panel = dialog.querySelector('.wiw-panel:not([hidden])');
        const items = Array.from(dialog.querySelectorAll('.wiw-close, .wiw-panel button, .wiw-input, .wiw-remember'))
            .filter(el => !el.disabled && el.getClientRects().length
                && (el.closest('.wiw-panel') === panel || el.classList.contains('wiw-close')));
        const next = nearest(items, document.activeElement, e.key);
        if (next) {
            e.preventDefault();
            next.focus();
        }
    }

    // Spatial focus movement for remotes and arrow keys: the closest control in the pressed
    // direction, preferring ones on the same row/column.
    function nearest(items, from, key) {
        if (!items.includes(from)) {
            return items[0];
        }

        // Fields and checkboxes are placed by their label, which spans the row.
        const box = el => (el.closest('label') || el).getBoundingClientRect();
        const a = box(from);
        let best = null;
        let bestScore = Infinity;
        for (const el of items) {
            const b = box(el);
            const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
            const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
            const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
            const along = { ArrowLeft: -dx, ArrowRight: dx, ArrowUp: -dy, ArrowDown: dy }[key];
            const across = Math.abs(horizontal ? dy : dx);
            const score = along + across * 2;
            if (el !== from && along > 1 && score < bestScore) {
                best = el;
                bestScore = score;
            }
        }

        return best;
    }

    function hash(text) {
        let h = 0;
        for (const c of String(text)) {
            h = (h * 31 + c.charCodeAt(0)) >>> 0;
        }

        return h;
    }

    function icon(path) {
        return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
    }
})();
