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

1. **Before guests arrive:** host screen → move the mouse → **⚙ Settings → Roster**, paste your 20 people, one per line:
   `Name | Character` (the character is optional). Save. Guests can start scanning and picking their name while still **Opening soon**.
2. **Awards done:** **Open voting ▶**. The screen shows how many have voted, and whose chip has lit up (never *who they voted for*).
3. **When everyone's in:** **Close voting ■** → **Reveal winner 🏆**. Drumroll, winner card, confetti, full ranking. A tie shows joint winners.

The control bar fades out after a few seconds so the projector stays clean; move the mouse to bring it back.

### Rules the app enforces
* One vote per person. Guests pick **who they are** first, so nobody can vote for themselves or vote twice.
  A name can be claimed by one phone only; if someone picked wrong or switched phones, **Settings → Guests → Release**.
* Guests can change their vote until voting closes.
* Standings stay on the server until you reveal. Turn on **Live standings** in the bar if you'd rather show a running tally.
* Votes are saved to `data/state.json`, so restarting the server mid-party loses nothing. **Reset everything** (Settings) wipes it.

## Tests

```bash
npm test      # API rules: claim/vote/self-vote/closed phase/ties/release/reset/restart persistence
```
