# Damneth Tours & Travels website: setup and editing

The site is plain HTML, CSS and JavaScript. Two things sit on top of it:

- **Languages.** Visitors can switch between English, Deutsch, Français, Русский and עברית. Hebrew pages turn right to left. The choice is remembered in the browser.
- **Content manager** at `/admin/`. Signed-in editors can change journey prices, what each journey includes, the day-by-day plans and the gallery photos and videos, without touching code.

```
index.html … gallery.html   the six pages (English, with translation keys)
assets/                     styles, scripts, fonts, photos, videos, language bundles (assets/i18n)
content/                    what the content manager edits: journeys, gallery, prices (JSON)
i18n/                       translations of the page text, one folder per language
admin/                      the content manager (Decap CMS) and its settings, admin/config.yml
tools/                      build and translation scripts (Node.js 20 or newer, no packages needed)
netlify.toml                how Netlify builds and publishes the site
```

## 1. Put the site online (once)

The content manager saves its changes to a GitHub repository, and Netlify rebuilds the site from it.

1. Create a GitHub account if you do not have one, and a new repository (it can be private).
2. Upload everything in this folder to the repository. `_site/` is the build output and is left out by `.gitignore`.
3. In Netlify: **Add new project → Import an existing project → GitHub**, and pick the repository.
   The build settings are read from `netlify.toml` (build command `node tools/build.mjs`, publish folder `_site`). Deploy.
4. Optional: add your own domain under **Domain management**.
5. In `admin/config.yml`, replace `YOUR-SITE.netlify.app` in the `site_url` and `display_url` lines with the real address and remove the `#` in front of them.

## 2. Turn on the admin login (once)

Editors sign in with an email address and a password (Netlify Identity). Only invited people can get in.

1. In Netlify, open the project's **Identity** page and choose **Enable Identity**.
2. Under **Project configuration → Identity → Registration**, choose **Invite only**. Do not skip this: with open registration anyone could create a login.
3. On the same page, under **Services → Git Gateway**, choose **Enable Git Gateway**. This lets the content manager save to GitHub on the editors' behalf, so they do not need GitHub accounts.
4. Open the **Identity** tab → **Invite users**, and enter the email address of each editor.
5. Each editor gets an email. The link opens the website, which forwards them to `/admin/` to choose a password. After that they sign in at `https://<your site>/admin/`.

Forgotten passwords: use **Forgot password?** on the login screen. Remove an editor in the **Identity** tab.

> **Good to know.** Netlify planned to retire Identity in 2025 and reversed that in February 2026, so it is supported. Git Gateway is in maintenance mode: it works, but gets no new features. If Netlify ever retires it, editors can sign in with GitHub accounts instead. Change the `backend` section of `admin/config.yml` to the lines below, and give each editor access to the repository:
>
> ```yaml
> backend:
>   name: github
>   repo: YOUR-GITHUB-NAME/YOUR-REPOSITORY
>   branch: main
> ```
>
> GitHub sign-in through Netlify also needs a GitHub OAuth app, added in the project's OAuth settings on Netlify.

## 3. Editing content

Sign in at `/admin/`. There are three sections.

| Section | What you can change |
|---|---|
| **Journeys** | Title, introduction, the three photos, route highlights, what's included (with icons), the day-by-day plan, the note at the end, the order on the page. Add a new journey, or hide one without deleting it. |
| **Gallery** | Upload photos and videos, give them a title and a description, choose the filter (Wildlife, Hill Country, Beaches & Coast, Culture & Heritage, With our guests), change the order, hide or delete them. |
| **Settings → Prices** | The prices on the Home, Destinations and Journeys pages: multi-day journeys per day (from and up to) and airport or day transfers (from). They are shown in US dollars in every language. |

**Publish.** Click **Publish → Publish now**. Netlify rebuilds the site, which takes a minute or two. If something is wrong, for example a video without a poster image, the build stops and the old version of the site stays online. The reason is shown under **Deploys** in Netlify.

**Translations.** Every journey and gallery item has the same text in five languages. Switch the language at the top of the editor, or show two languages side by side. English is the master copy. Photos, icons, order and categories are set in English, and the other languages only hold text. If you leave a translated field empty, the site shows the English text there.

Lists such as the route, "what's included" and the days are matched by position. Keep the same number of items, in the same order, in every language. When you add a day in English, add it to the translations too. Until you do, the new day shows in English.

**Photos.** JPG, PNG or WebP, ideally at least 1600 pixels wide. On Netlify, smaller copies for phones are made automatically. Write a short description of every photo for visitors who use screen readers.

**Videos.** MP4, ideally under a minute and under 20 MB (the limit is 25 MB). Choose a poster image too: the still shown before the video plays. Every upload stays in the repository's history for good, so large videos make it heavier over time.

**Home page video.** The background video at the top of the home page is not in the content manager. It has three files in `assets/videos/`: `hero-bg.mp4` (1280×720) for large screens and for phones or tablets held sideways, `hero-bg-mobile.mp4` (406×720, 9:16) for phones held upright, and `hero-bg-tablet.mp4` (540×720, 3:4) for tablets held upright. The two upright files are cut from the large one, with a crop that follows each scene's subject. If you replace the video, replace all three. Visitors who have reduced motion or data saving turned on, or whose phone blocks autoplay to save battery (iOS Low Power Mode), see the photo instead. When autoplay is blocked, the round play button under the route list starts the video.

**Logo.** The logo is not in the content manager either. The master copy is `assets/icons/New Logo.jfif`. The site uses copies made from it: the round emblem in `assets/images/logo-seal-*.webp` (several sizes, so it stays sharp on high-resolution screens) and the browser icons `favicon.ico`, `assets/icons/favicon-32.png`, `favicon-192.png` and `apple-touch-icon.png`. The name beside the emblem in the header is live text, so it stays sharp at any size. To change the logo, replace those files with new copies of the same names and sizes.

**Deleting.** Deleting a gallery item removes it from the page. The uploaded file stays in the media library (the **Media** button at the top) until you delete it there as well. To take something off the site for a while, use **Hide from the site** instead.

## 4. Languages

- The language menu is in the header and in the mobile menu. The choice is saved in the visitor's browser (`localStorage`, key `damneth-lang`). A link can choose the language too: `journeys.html?lang=de`.
- Hebrew switches the whole page to right to left.
- On laptop-width screens (1024 to 1199 pixels), the Home link and the Instagram icon leave the header to make room for the language menu. The logo still links home, and Instagram is in the footer and the side buttons.
- Prices stay in US dollars. Guest reviews are shown as the guests wrote them. Enquiries sent through WhatsApp or email are in English, with a "Preferred language" line, so you know which language to reply in.
- Search engines see the English pages, because the language is switched in the browser.

**The translations are drafts.** They were written by Claude (AI) and are marked `"draft – needs native review"`. Please have a native speaker read them before relying on them, especially Hebrew and Russian.

Where the translations live:

| Text | File |
|---|---|
| Page text (headings, paragraphs, buttons, menus) | `i18n/<language>/common.json` and `i18n/<language>/<page>.json` |
| Messages from the scripts, trip planner names, gallery and journey sentences | `i18n/<language>/strings.json` |
| Journeys and gallery | the content manager (stored in `content/`) |

Each catalog entry looks like `{ "en": "English text", "de": "Übersetzung" }`. Keep markers such as `<1>…</1>`, `<2/>` and `{name}` exactly as they are. They stand for links, icons and numbers.

Commands (run from this folder):

| Command | What it does |
|---|---|
| `node tools/i18n.mjs sync` | After you change English text in a page: bakes the content into the pages, gives new text a translation key and adds it to the catalogs |
| `node tools/i18n.mjs status` | How much of each language is translated |
| `node tools/i18n.mjs todo de` | Lists the German text that still needs translating (`fr`, `ru`, `he` work too) |
| `node tools/i18n.mjs compile` | Rebuilds the language bundles in `assets/i18n/` after you edit a catalog |
| `node tools/i18n.mjs check` | Reports anything out of date |
| `node tools/build.mjs` | Everything Netlify does: bake, compile, and copy the site into `_site/` |

## 5. Working on your own computer

Run `node tools/build.mjs` and open `_site/` with any static web server, for example:

```bash
python -m http.server 8080 --directory _site
```

The content manager can sign in only on the Netlify site, because login and saving go through Netlify. To edit content offline, change the JSON files in `content/` and run the build.
