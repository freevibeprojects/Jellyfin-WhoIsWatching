# Who's Watching (Jellyfin plugin)

A Netflix-style **"Who's watching?"** profile switcher inside Jellyfin Web. It greets you on the
sign-in page, and switches profile from your avatar in the top bar: pick a profile, enter its password
if needed, and you are now that user.

- Jellyfin **12.0+** (built against 12.0.0, tested on 12.2.0)
- Server side: one ~85 KB DLL with no dependencies, no background work and no database. A settings page in the dashboard; the shared picture gallery is plain files.
- Client side: one 65 KB script (about 20 KB compressed), cached after the first load. Signed out, it loads the sign-in page's profiles while Jellyfin Web starts; signed in, it stays idle until the avatar is clicked

**Install:** add `https://raw.githubusercontent.com/freevibeprojects/Jellyfin-WhoIsWatching/main/manifest.json` as a repository in *Dashboard → Plugins → Manage Repositories*, then install **Who's Watching** from *Available*. See [Install](#install).

## How it works

| Piece | What it does |
|---|---|
| `ScriptInjection.cs` | An ASP.NET Core `IStartupFilter`, registered through Jellyfin's `IPluginServiceRegistrator`. When `…/web/` or `…/web/index.html` is served, it appends `<script defer src="../WhoIsWatching/client.js?v=…">`. Nothing is written to disk, so read-only installs (Docker, distro packages) work. Every other request costs one string comparison. |
| `ClientScriptController.cs` | Serves the embedded script (`GET /WhoIsWatching/client.js`) anonymously. It is static and holds no data. |
| `GalleryController.cs` | The brand-text settings (`GET /WhoIsWatching/Settings`, anonymous, because the sign-in page shows the brand text) and the shared picture gallery (`/WhoIsWatching/Images`). See *Profile pictures*. |
| `Web/client.js` | Covers Jellyfin's sign-in page with the picker, and intercepts clicks on the avatar button to show it. It switches users with Jellyfin's own client API, then reloads the page. *Manage profiles* changes pictures; the gear runs the avatar button's normal action (settings or user menu). |
| `Web/config.html` | The plugin's page in *Dashboard → Plugins*: brand text, and removing gallery pictures. |

The switch uses only what the login page uses:

1. The profile list comes from `GET /Users/Public`, the login screen's own list. The server has already applied every rule: *Hide this user from login screens*, disabled accounts, device access, and remote-access restrictions.
2. Sign-in goes through `ApiClient.authenticateUserByName`, which is the login page's call to `POST /Users/AuthenticateByName`. The web client stores the new session exactly as after a normal sign-in.
3. The previous user's token is revoked with `POST /Sessions/Logout`. This is needed because Jellyfin only replaces tokens of the *same* user on a device, so without it the old token would stay valid.
4. The page fully reloads to the home screen. Many of jellyfin-web's query-cache keys don't include the user ID, so switching without a reload could show the previous profile's cached rows (for example, an adult's suggestions on a child's profile).

There is no new authentication endpoint, session store, cookie or cryptography. The plugin's own endpoints only serve its script, its settings and the picture gallery.

### The sign-in page

Signed out (a first visit, or after signing out), the picker covers Jellyfin's sign-in page and lists the same profiles. Jellyfin's page stays underneath: **Other ways to sign in** (or Escape) shows it, for Quick Connect and *Forgot password*. Jellyfin's *Login Disclaimer* (Dashboard → General → Branding) is shown under the profiles, as plain text. After signing in you land where Jellyfin's page would have taken you (a shared link, for example). If no profile is listed, Jellyfin's page shows as it is.

**Other account**, the last tile, signs in to an account the list doesn't show (one hidden from the sign-in screen, such as the administrator's) by asking for its name and password. It is there on the avatar's picker too, so switching to a hidden account doesn't need signing out first.

The picker doesn't wait for the page. The profiles, the brand text and the profile pictures are requested while Jellyfin Web is still starting (it makes several more round trips before it shows its sign-in page) and when you sign out. The picker shows, without fading in, as soon as they and Jellyfin's theme are in, usually before Jellyfin's own sign-in page has finished loading; that page then arrives underneath. Closing the picker that early leaves Jellyfin's page alone when it comes. Jellyfin applies the server's Custom CSS only once its sign-in page shows, so the picker picks up the page background when that arrives.

### Password behaviour

Jellyfin 12 never tells clients whether a user has a password: `UserDto.HasPassword` is always `true`, and the login page always shows the password form. This plugin keeps that rule.

- Every profile gets a password step, and leaving it blank is allowed.
- A profile is never tried with a blank password automatically. A wrong guess would count toward Jellyfin's login lockout and appear in the activity log.
- After a profile signs in with a blank password once, this browser remembers its **user ID** (in `localStorage`, per server) and switches to it in one click next time. If a password is added later, the one-click attempt fails once and the password step appears.
- **Remember on this device** (in the password step) keeps that profile signed in on this browser, so it opens in one click, like Jellyfin's own *Remember me*. What is kept is the profile's Jellyfin access token, never the password. Switching away from a remembered profile leaves its session running instead of ending it.
  - **Administrator accounts can never be remembered.** They always ask for the password, so a child on a shared TV can't one-click into the account that controls parental settings.
  - A remembered profile is forgotten, and asks for its password again, when its password is changed, its session is ended (for example from *Dashboard → Devices*), or anyone signs out of Jellyfin in this browser. Signing out also ends every remembered profile's session.
  - The server still applies the profile's rules (disabled account, access schedule, remote access) every time it is used.
  - Accounts signed in to through *Other account* aren't offered it: they aren't listed, so there is no profile to open in one click.
- Signing in from the picker always keeps the session across reloads, like Jellyfin's own *Remember me* (its default). The picker reloads the page after every sign-in, so it turns that setting back on if it was unticked earlier in this browser; otherwise the reload would land on the sign-in page again.

### Look

The picker scales with the screen: the same proportions on a phone, at 1080p, on a 1440p (2K) monitor and at 4K, limited by height on wide or short windows. Older engines without `clamp()` keep the 1080p sizes.

It is styled by the active theme, the way Jellyfin's own pages are: its buttons, password field, checkbox and pictures carry Jellyfin's own classes (`emby-button`, `button-submit`, `emby-input`, `emby-checkbox`, `cardImageContainer`), so the built-in themes and any Custom CSS restyle them too. Nothing is rounded unless the theme rounds Jellyfin's cards and buttons (`--jf-card-borderRadius`), profiles without a picture get the theme's card colours, and the background is the page's own (a theme's image, or a Custom CSS background on `body` or `.backgroundContainer`), read each time the picker opens. The ring around the current profile takes the colour of Jellyfin's primary buttons. In the TV layout, the focused button grows as on Jellyfin's TV pages.

The brand text in the corner (like Netflix's logo) is set in *Dashboard → Plugins → Who's Watching*: text, colour, size and position (top left, centre or right). It defaults to "Jellyfin" in Jellyfin's logo purple, `#AA5CC3`. Leave the text empty to hide it. Text too wide for the screen is cut short with an ellipsis.

### Profile pictures

It works like Netflix:

1. **Manage profiles**, under the profiles, switches to edit mode. Profiles you may change show a pencil: your own, or every profile for administrators. This follows Jellyfin's rule *Allow this user to manage their own preferences*.
2. Picking one opens **Choose a profile picture**, a page with a shared gallery that everyone sees. The **+** tile adds a picture to it. The picture is cropped to a centred square and shrunk to at most 512 px (JPEG) first, because Jellyfin serves profile pictures at their uploaded size.
3. Picking a picture asks **Change profile picture?** (current → new), with **Let's do it** / **Not yet**.

The picture is then copied to the profile through Jellyfin's own user-image API, which applies Jellyfin's permission checks.

Each person may add up to 20 pictures (administrators: up to the gallery's 200). Jellyfin's TV layout has no **+** tile, since a remote can't pick a file: pictures added from a phone or computer show up there.

The gallery is kept on the server in `<data dir>/plugins/configurations/WhoIsWatching/images/`, one folder per person who added pictures, so it survives plugin updates. Administrators remove pictures in the plugin's dashboard page. Removing one doesn't change anyone's current picture.

## Admin setup

**Jellyfin 12 hides new users from login screens by default**, and the picker shows exactly the users the login screen would. For each profile that should appear, go to *Dashboard → Users → (user) → Profile* and untick **Hide this user from login screens**.

Hidden accounts stay reachable through **Other account**, which asks for the name as well as the password.

If a profile goes missing from the picker, check whether it was locked out: after too many wrong passwords (*Dashboard → Users → (user) → Profile → login attempts before lockout*), Jellyfin disables the account, so it is no longer listed. Re-enable it on the same page.

## Supported clients

The plugin only works where the server's own Jellyfin Web UI runs, because that is the only place the script can load.

| Client | Status |
|---|---|
| Jellyfin Web in a browser (modern, legacy and TV layouts) | Supported; all three layouts tested end to end |
| Jellyfin Desktop / Jellyfin Media Player, the Jellyfin Android app, Jellyfin for webOS | Supported: they load the server's web UI (the Android app only swaps jellyfin-web's main bundle). Tested through browser emulation and with the fallbacks below forced on, not on the devices themselves. |
| Jellyfin for Tizen | Not supported: it bundles its own copy of jellyfin-web |
| Android TV, Swiftfin, Findroid, Streamyfin, Kodi, Infuse, other native apps | Not supported: they don't run Jellyfin Web |

Engine requirements: ES2017 (`async`/`await`), which means Chrome/Edge/WebView 55+, Firefox 52+, Safari 11+ (iOS 11+) and webOS 5+. Newer features have fallbacks, so older engines get the full picker:
- `<dialog>`: a full-screen stand-in for Safari before 15.4 and old WebViews
- `replaceChildren`, `createImageBitmap`
- `:focus-visible`: `:focus` instead, so TV remotes still show the highlight
- flexbox `gap`, `aspect-ratio`, `clamp()`/`max()`/`env()`

The end-to-end test runs once more with these APIs removed (`OLD_ENGINE=1`).

### If the avatar still shows its normal menu

1. **Reload the page after installing or updating.** The script is added when Jellyfin Web loads, and an open page keeps running without it, even across a server restart.
   - Browsers: press F5.
   - Jellyfin Desktop / Media Player: restart the app.
   - **Android app: swipe it away (or Force stop) and reopen it.** It keeps its page loaded in the background.
2. **Profiles missing from the picker?** It lists the profiles the sign-in screen shows, plus yourself. Accounts with *Hide this user from login screens* ticked (Jellyfin 12's default for new users) are reached through *Other account*; to list one, untick it in *Dashboard → Users → (user) → Profile*.
3. **Check the console** (F12 in browsers). `[WhoIsWatching] 1.4.2.0 loaded` confirms the script is there, and a second `[WhoIsWatching]` line says why the avatar was left alone.

## Compatibility surface

Jellyfin has no official extension point for the main web UI, so the plugin relies on the items below. They are kept in one place and checked at runtime; if any is missing, the plugin steps aside and the avatar works as before.

| Dependency | Stability |
|---|---|
| `IPluginServiceRegistrator` | Public plugin API |
| `IStartupFilter` honoured by Jellyfin's ASP.NET Core generic host | Standard ASP.NET Core; Jellyfin has used `Host.CreateDefaultBuilder` + `UseStartup` since 10.x |
| `/Users/Public`, `/Users/AuthenticateByName`, `/Sessions/Logout` | Public REST API |
| `window.ApiClient` and its methods | Undocumented global, but jellyfin-web keeps it for plugins and uses it in its own code. `client.js` checks each method before taking over the click. Optional extras are checked too: `onAuthenticated` (Remember on this device), `logout` (wrapped so signing out forgets remembered profiles), `uploadUserImage` (Manage profiles). Its first assignment is watched, to request the sign-in page's profiles early. |
| `.button-submit` colour | Read at runtime for the accent; falls back to the theme variable and then Jellyfin blue |
| The sign-in page: `#loginPage`, its `viewbeforeshow`/`viewshow` events, `GET /Branding/Configuration`; before it shows, `.mainAnimatedPage`, a stylesheet under `/themes/` and `--jf-palette-background-default` | Internal markup and events; without them the sign-in page is Jellyfin's own, and the avatar still works |
| Jellyfin's classes `emby-button`, `raised`, `button-submit`, `emby-input`, `emby-checkbox`, `paper-icon-button-light`, `cardImageContainer`, `defaultCardBackground1-5`, and `--jf-card-borderRadius` | Used for the look only; if renamed, the controls fall back to the browser's plain style |
| `localStorage.enableAutoLogin`, `localStorage.jellyfin_credentials` | Jellyfin Web's *Remember me* setting (see *Password behaviour*), and its saved sign-ins, only read: with one saved, the sign-in page's profiles aren't requested early. Without them, the sign-in page waits for its profiles, as in 1.4.1. |
| Avatar selectors `.headerUserButton`, `[aria-controls="app-user-menu"]` | Internal markup, **the most likely thing to break**. One constant at the top of `client.js`. |
| `--jf-palette-*` CSS variables | MUI theme variables; every use has a fallback colour |

After a Jellyfin upgrade, run the smoke test (below) to check all of these at once.

## Security notes

- Passwords are read from the form, sent once to Jellyfin's login endpoint, and the field is cleared. They are never stored or logged.
- **Use HTTPS.** The plugin adds no encryption of its own: the password travels in the body of `POST /Users/AuthenticateByName`, exactly as from the login page, so it is protected only if Jellyfin or a reverse proxy serves HTTPS. Over plain HTTP it crosses the network in cleartext, and switching profiles means typing passwords more often than signing in once.
- The plugin stores, per server in `localStorage`: the passwordless hint (user IDs) and, only for profiles you tick *Remember on this device* for, their access tokens. It never stores a password. Values of the wrong shape (corrupt or tampered) are ignored, so they can't trigger sign-in attempts.
- A remembered profile is as exposed as Jellyfin's own *Remember me*: **anyone who can use this browser or TV can open it**, and a script running in the page (another plugin, or an XSS in Jellyfin Web) could read its token, as it can already read the signed-in user's token in `jellyfin_credentials`. Remember only profiles you'd leave signed in on that device. Changing the password, or ending the session in *Dashboard → Devices*, cuts a remembered device off.
- **Updates come from this GitHub repository.** Jellyfin's *Update Plugins* task installs new versions automatically, and a plugin runs with the server's full rights, so whoever controls the repository controls code on your server. If you'd rather review each update, remove the repository after installing and add it back when you want to update.
- Every refusal shows one generic message (401 and 403 alike), so the response doesn't reveal why a sign-in was rejected.
- User names, the brand text and the Login Disclaimer are only ever inserted with `textContent`. The brand settings are validated on the server: a `#RRGGBB` colour, 12–120 px, one of three positions, at most 40 characters.
- Picture gallery (`/WhoIsWatching/Images`):
  - Listing needs a signed-in user. Each picture is served anonymously by its random ID, because an `<img>` can't send a token; Jellyfin serves user pictures the same way.
  - Adding needs *Allow this user to manage their own preferences*. Only JPEG is accepted (the picker re-encodes every upload to JPEG, which also drops location data from photos), checked by its bytes (a whole JPEG: start and end markers, and a declared size of at most 1024 × 1024 pixels, so a small file can't make every viewer's browser decode a gigantic picture), at most 1 MB each, 20 per person (so one account can't fill it for everyone) and 200 in total. Every profile's browser shows these pictures, so other image formats (WebP's decoder had a remote-code-execution bug, CVE-2023-4863) are refused.
  - Files are named by the server (a new GUID), so nothing a client sends becomes a path. They are served with `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`.
  - Only administrators can delete.
  - Profile pictures are applied through Jellyfin's own API, so Jellyfin's permission checks decide who may change whose picture.
- Lockout, parental access schedules, device restrictions, max sessions and remote-access policy are all enforced by the server, because the plugin goes through Jellyfin's normal sign-in.
- Switching signs the previous profile out on this device. Other open tabs still running as that profile lose access, because its token is revoked, and pick up the new profile when reloaded. They share the browser's stored session, as with any Jellyfin sign-in.
- Anyone who can open the picker can attempt any listed profile's password. That is the same exposure as Jellyfin's login screen, which shows the same list to anyone. Use *Hide this user from login screens* for accounts that shouldn't be offered. *Other account* takes any name, as Jellyfin's manual sign-in does, and every refusal looks the same, so it doesn't reveal which names exist.

## Limitations

- English UI text only (the `TEXT` object in `client.js`).
- Users who only sign in through Quick Connect or an SSO plugin can't be switched to by password. Use the normal sign-out flow for them.
- The Login Disclaimer is shown as plain text: Markdown or HTML in it appears as typed. Jellyfin's own page (Other ways to sign in) shows it formatted.
- Jellyfin serves profile pictures at their uploaded size: it ignores size options for user images, so the login page downloads them in full too. Pictures added through the picker's gallery are shrunk first; ones uploaded in the dashboard are not, so a multi-megabyte phone photo set there is downloaded in full the first time the picker opens.

## Install

On a Jellyfin 12.x server:

1. Go to *Dashboard → Plugins*, then **Manage Repositories** → **New Repository**.
2. Enter any name (for example `Who's Watching`) and this URL, then **Add**:
   ```
   https://raw.githubusercontent.com/freevibeprojects/Jellyfin-WhoIsWatching/main/manifest.json
   ```
3. Back in *Plugins*, open **Available**, choose **Who's Watching**, and **Install**.
4. Restart Jellyfin (*Dashboard → Restart*), then reload every client (see *If the avatar still shows its normal menu* above). On Android, swipe the app away and reopen it.

New versions appear as updates in *Dashboard → Plugins*, and Jellyfin's *Update Plugins* scheduled task installs them.

Upgrading from a manual install: delete the old `WhoIsWatching_*` folder from the plugins directory first, so only the repository's copy is loaded.

### Build from source

```sh
dotnet build Jellyfin.Plugin.WhoIsWatching -c Release
# copy bin/Release/net10.0/Jellyfin.Plugin.WhoIsWatching.dll to
#   <jellyfin data dir>/plugins/WhoIsWatching/ and restart Jellyfin
```

Some Linux-distro .NET SDKs ship without the ASP.NET Core targeting pack and fail with
`NETSDK1226: Prune Package data not found`. Install the `aspnet-targeting-pack` package, or build with
`-p:AllowMissingPrunePackageData=true`.

### Publishing a release

1. Bump `<Version>` in the `.csproj` and `version` in `build.yaml`, and write the `changelog` there. The client script is cached by version, so every change needs a new one.
2. Run `./release.sh`. It builds `releases/who-is-watching_<version>.zip` (no debug info or local paths) and adds it, with its MD5 checksum, to `manifest.json`. The catalog text comes from `build.yaml`.
3. Commit and push. Servers see the update from the repository URL.

## Smoke test

`test/` drives a real server and a headless Chromium through the whole flow. It checks:

- the picker's contents and keyboard navigation
- that a wrong password leaves the current session untouched
- switching, and that the previous token is revoked
- passwordless one-click switching, and that a tampered passwordless hint triggers no sign-in attempt
- Remember on this device: one click with no password sent, administrators excluded, an ended session asking for the password again, and signing out (even with nothing clicked first) forgetting remembered profiles
- switching to an account hidden from the sign-in screen through Other account, without signing out
- Manage profiles (who may change which picture), adding a gallery picture (square, at most 512 px), reusing it for another profile, and the dashboard page saving settings and deleting pictures
- the sign-in page: the picker over it, ready with the page (profiles requested ahead on a first visit and at sign-out, no fade-in), Other ways to sign in, signing in from it, the Login Disclaimer and the page background
- the brand text (default and custom), the gear icon, and Custom CSS reaching the picture rounding, the Sign in button and the password field
- switching where Jellyfin's *Remember me* was unticked, the TV layout without a file picker, and the gallery's per-person cap
- scaling (profiles 4/3 as big at 1440p and twice as big at 4K as at 1080p, no sideways overflow on phones), and that pressing the avatar preloads the profiles
- the gallery API's rules (below)
- that the avatar's original action is passed through, including when the picker can't be shown
- that no password ends up in `localStorage`

```sh
cd test && npm install
JF_URL=http://127.0.0.1:8096 ./setup.sh        # fresh server, wizard not yet run
node e2e.js && node e2e.js desktop-legacy && node e2e.js tv
OLD_ENGINE=1 node e2e.js     # again without <dialog>, replaceChildren and createImageBitmap
```

## License

[GPL-3.0-only](LICENSE): the GNU General Public License, version 3 only. Jellyfin's plugin packages (`Jellyfin.Controller`, `Jellyfin.Common`) are GPL-3.0-only too.
