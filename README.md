# MCQ Practice Quiz

**Live site:** https://tinyshelf.github.io/mcq/

A static quiz site that works on phones and desktops. It has no build step and no server code.

| File | What it is |
|---|---|
| `index.html` | The app: layout, styles and logic |
| `questions.json` | The question bank. Replace this file to change the questions. |
| `sync.js` | Optional cross-device sync: encryption, merging and the GitHub gist calls |
| `sync.json` | Created during sync setup: your GitHub token and the gist id, encrypted with your passphrase |
| `tests/` | Tests for `sync.js` (`node --test`) |

## Features

- Tap an option to see right or wrong straight away. A wrong pick turns red, the correct option turns green, and the explanation appears below.
- Filter by topic and difficulty. Choose 10, 25, 50, 100 or all questions, with an optional shuffle.
- **Mistakes** mode practises only the questions you got wrong last time. **Unattempted** mode practises only the ones you have never answered.
- The results screen shows your score, a breakdown by topic (weakest first), a review of wrong and skipped answers, and a **Retry missed** button.
- Progress and any unfinished quiz are saved in the browser, so you can close the tab and resume later.
- Optional **sync** shares progress and the unfinished quiz between your phone, laptop and any other device (see below).
- On desktop you can use the keyboard: `A`–`D` or `1`–`4` to answer, `Enter`/`→` for the next question, `←` for the previous one.
- Dark mode follows your device setting.

## Changing the questions

Replace `questions.json` with a new file that uses the **same name** and the same format, then redeploy (see below). The site reads the file each time it loads, so the new questions appear right away.

```json
{
  "title": "Shown as the page heading",
  "syllabus": "Optional subtitle",
  "questions": [
    {
      "id": "LNX-001",
      "topic": "UNIX / Linux Basics",
      "subtopic": "OS architecture",
      "difficulty": "Easy",
      "question": "Which component of Linux directly manages the CPU?",
      "options": { "A": "Window manager", "B": "Shell", "C": "Kernel", "D": "Terminal emulator" },
      "answer": "C",
      "explanation": "The kernel is the core of the OS..."
    }
  ]
}
```

- **Required:** `question`, `options` (2 or more) and `answer`. Everything else is optional.
- `options` can be an object (`{"A": "...", "B": "..."}`) or a list (`["...", "..."]`, which is labelled A, B, C… automatically).
- `answer` can be the option letter (`"C"`), the exact option text, or a 0-based number.
- The `topics` and `total_questions` fields are ignored. Topics and counts are worked out from the questions themselves.
- Questions with a missing or invalid answer are skipped, and the home screen shows how many were skipped.
- Keep the `id` values stable. Saved progress is linked to the id plus the question text.

**Several banks at once:** upload extra files next to `index.html` (for example `banking.json`) and open `https://your-site/?data=banking.json`.

**Try a file without redeploying:** on the home screen, tap **Open another JSON file** and pick a JSON file from your device. This only lasts until the page is reloaded.

## Testing locally

Opening `index.html` by double-clicking will **not** work, because browsers block loading the JSON from `file://`. Run a tiny local server instead:

```
cd quiz-site
python -m http.server 8000
```

Then open http://localhost:8000.

Run the sync tests with Node 20 or later: `node --test` inside `quiz-site`.

## Syncing progress across devices

Progress lives in one **secret gist** on your GitHub account (`mcq-progress.json`). The site writes to it with a GitHub token that only has `gist` access. The token and the gist's id sit in `sync.json` **encrypted with your passphrase** (AES-256-GCM, key from PBKDF2-SHA256 with 600,000 rounds). The public repository therefore holds no usable secret, and does not point to the gist, which anyone holding its id could read.

### One-time setup (on your own device)

1. Open the site and tap **Set up sync** (top right of "Your progress").
2. Tap **Create a GitHub token**. On GitHub: set Expiration to **No expiration**, keep only **gist** ticked, click **Generate token**, copy it.
3. Back on the site, paste the token, choose a passphrase of 12+ characters, and tap **Encrypt & connect**. This device starts syncing straight away.
4. Copy the text shown under **Last step: publish sync.json** and commit it to this repository as `sync.json`. After a minute or two other devices can unlock. Commit from a computer with a neutral git name if you don't want your GitHub account on the commit; edits made on the GitHub website always show it.

### On every other device

Tap **Unlock sync**, type the passphrase, and tap **Unlock**.

- **Your own phone or laptop:** turn on **Remember on this device**, so you never type the passphrase there again.
- **Shared or public computer:** leave it off. The token is then kept only until the tab closes, and **Lock on this device** forgets it at once.

### How syncing behaves

- The site downloads the latest progress when it opens or when you come back to the tab, and uploads a few seconds after each answer and when you leave the tab.
- For each question, the most recent answer wins. The most recently touched quiz wins too, so you can start on the phone and continue on the laptop.
- **Reset progress** clears progress on every synced device.
- Without a connection the site keeps working on the device's own copy and catches up on the next sync.

### If something goes wrong

- **Forgot the passphrase, or want a new one:** on a device where sync works, open Sync, tap **Set up again**, and publish the new `sync.json` in place of the old one.
- **Token leaked, or a public computer may have recorded your passphrase:** delete the token at https://github.com/settings/tokens, then run **Set up again** with a new token and a new passphrase. The worst anyone could do with the old token is change your gists. It cannot touch your repositories or account.

## Deploying

### Option A: Netlify Drop (easiest, about 1 minute, no Git needed)

1. Go to https://app.netlify.com/drop and sign up for free (GitHub or email login works).
2. Drag the **`quiz-site` folder** onto the page.
3. You get a URL such as `https://random-name-123.netlify.app`. Open it on your phone.
4. Optional: go to **Site configuration → Change site name** to get a nicer URL.

**To update the questions later:** open the site in Netlify, go to the **Deploys** tab and drag the updated `quiz-site` folder onto the "Need to update your site? Drag and drop your site output folder here" box. The URL stays the same.

### Option B: GitHub Pages (from the browser, no Git commands)

1. Sign in at https://github.com and click **New repository**. Name it, for example, `mcq-quiz`. Choose **Public**, since free GitHub Pages needs a public repository. Click **Create repository**.
2. On the new repository page, click **uploading an existing file**. Drag in `index.html` and `questions.json` (and this README if you want it). Click **Commit changes**.
3. Go to **Settings → Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, Branch to **main**, folder **/ (root)**, then click **Save**.
4. Wait 1–2 minutes and refresh the page. The URL appears at the top: `https://<your-username>.github.io/mcq-quiz/`

**To update the questions later:** in the repository, click **Add file → Upload files**, drag in the new `questions.json` (it replaces the old one) and commit. The site updates within a minute or two.

> GitHub Pages and Netlify sites are public. Anyone with the link can see the questions.

### Option C: GitHub plus Netlify (automatic deploys)

Push the folder to a GitHub repository, then in Netlify choose **Add new site → Import an existing project → GitHub** and pick the repository. Leave the build command empty and set the publish directory to `/`. Every commit, such as a new `questions.json`, then deploys automatically.

## Using it on your phone like an app

Open the site URL, then:

- **Android (Chrome):** ⋮ menu → **Add to Home screen**
- **iPhone (Safari):** Share → **Add to Home Screen**

## Notes

- Without sync, progress is saved in your browser on each device separately. With sync, see the section above.
- **Reset progress** on the home screen clears the saved progress on that device, and on every synced device if sync is set up.
