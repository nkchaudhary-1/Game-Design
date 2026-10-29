# Bollywood Night — live "Best Dressed" voting

A projector screen shows a QR code; guests scan it on their phones, tap their own name, and vote for the best-dressed
person. The host closes voting and reveals the winner with a drumroll. No accounts, no database, **no dependencies** —
just Node 18+.

## Run it

```bash
cd bollywood-vote
node server.js          # or: npm start
```

The terminal prints two links:

* **Host screen** — `http://localhost:3000/host?key=…` — open this on the laptop connected to the projector.
* **Guest link** — `http://192.168.x.x:3000/` — this is what the QR encodes. Phones must be on the **same WiFi** as the laptop.

First run on a Mac may ask "Allow node to accept incoming connections?" — click **Allow**, or phones can't connect.

### If phones can't reach the laptop
Some routers isolate WiFi devices from each other. Either put the laptop on your phone's hotspot (and have guests join it),
or give the app a public address and set it as the QR link:

```bash
npx cloudflared tunnel --url http://localhost:3000     # prints https://<random>.trycloudflare.com
PUBLIC_URL=https://<random>.trycloudflare.com node server.js
```

You can also change the link any time from the host screen: **Settings → Voting link → Update QR**.

## Running the night

1. **Guest list.** Open the host screen. The first screen is **Who's coming?**: type one guest per line (`Name | Character`, the
   character is optional) and save. You can reopen it later with **Edit names** until voting starts.
2. **Ready.** The list is on screen. Run your awards. Nothing is shown to guests yet.
3. **Start voting.** The QR code appears with a **5:00 clock** (change it in Settings). Guests scan, tap their own name, vote.
   Voting closes by itself when the clock hits zero or everyone has voted. **+1 min** and **Close now** are in the control bar.
4. **Reveal.** The curtain hangs closed over "Voting closed". Press **Reveal winner**: drumroll, curtain opens, confetti.

The control bar fades out after a few seconds so the projector stays clean; move the mouse to bring it back.

### There is never a tie
If two or more people finish level at the top, **Reveal winner** doesn't reveal. It starts a **60-second tie-break** instead: phones
switch to a ballot with only the tied people, the projector shows who's tied and a new clock. If the tie-break is level too, a
random draw picks one. So there is always exactly one winner (or none, if nobody voted).

### Rules the app enforces
* One vote per person. Guests pick **who they are** first, so nobody can vote for themselves or vote twice.
  A name can be claimed by one phone only; if someone picked wrong or switched phones, **Settings → Guests → Release**.
* Guests can change their vote until the clock runs out.
* Standings stay on the server until you reveal. Turn on **Live standings** in the bar if you'd rather show a running tally.
* The Node server saves to `data/state.json`, so restarting it mid-party loses nothing. **Reset everything** (Settings) wipes it.
* Optional: put a `roster.json` (`[{ "name": "Priya", "character": "Geet" }]`) next to `server.js` to pre-fill the guest list.

## Host it on Vercel (a real public link)

Vercel runs functions, not a long-lived server, so this repo ships a second, serverless mode: the same rules (`lib/core.js`),
state kept in a Redis hash (`lib/redis-store.js`), and phones **poll** every 2 seconds instead of being pushed to.
Each vote is its own Redis field, so 20 people voting at once can't overwrite each other.

1. **Vercel → Add New → Project → import this GitHub repo.** Set **Root Directory** to `bollywood-vote`. Leave everything else as is.
2. **Storage → Create → Upstash Redis** (free plan), connect it to the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. **Settings → Environment Variables:** add `HOST_KEY` with any long random string. This is the password for the host screen.
4. **Deploy** (or Redeploy, if you added the variables after the first deploy). The guest list is typed into the host screen and
   stored in Redis, so there is nothing else to configure.

Then open `https://<your-project>.vercel.app/host?key=<HOST_KEY>` on the projector laptop. The QR points at the same site, so
guests need no WiFi tricks, just any internet. Until steps 2 and 3 are done the site answers `not_configured`.

## Click-through demo

`npm run build:demo` builds `demo/dist/demo.html`: the real guest and host screens side by side in one page, wired to the same
voting rules (`lib/core.js`) with 20 dummy guests you can trigger. No server needed; open `demo/dist/standalone.html` in a browser.

## Tests

```bash
npm test      # API rules: claim/vote/self-vote/closed phase/ties/release/reset/restart persistence
```
