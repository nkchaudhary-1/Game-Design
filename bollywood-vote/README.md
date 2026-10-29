# Bollywood Night Awards: Best Dressed

A static website for the Best Dressed award. The host opens the site on a laptop and shares that screen on the projector.
Guests scan a QR code, tap their name and vote on their own phones. Scores stay hidden until the host reveals the winner
behind a curtain.

* **Host:** `https://<your-site>/` (guest details, then the Best Dressed Award page)
* **Guests:** `https://<your-site>/vote#<code>` (this is what the QR code opens)

There is **no database, backend, login or external storage**. Guest details and votes live in the host's browser
(`localStorage`), and the whole site is plain HTML, CSS and JavaScript.

## Deploy on Vercel (about 3 minutes, free plan)

1. **Vercel → Add New → Project → import this GitHub repo.**
2. Set **Root Directory** to `bollywood-vote`.
3. Click **Deploy**. There is nothing to configure: no environment variables, no database, no build step.

Any static host works the same way if you point it at the `public/` folder.

## How votes get from phones to the host

Browser storage is per device, so a QR code alone cannot carry votes back to the host. This site connects each phone
**directly to the host's browser over WebRTC**:

* The host page is the "server". It holds the guest list and votes in `localStorage`, runs the voting rules
  (`public/js/core.js`) and answers the phones.
* The QR code carries the host's short connection code after the `#`. A phone that opens it asks PeerJS's free public broker
  to introduce it to the host, then talks to the host directly. The broker only passes connection details; votes and names never
  go through it, and nothing is stored anywhere but the host's browser.
* The host's connection code is saved too, so refreshing the host page keeps the same QR code, and phones reconnect by themselves.

What this means on the night:

* **Keep the host tab open** while voting runs (it can sit in the background while you share your screen). Refreshing it is fine.
* Everyone needs an internet connection (phones on cellular are fine). A few locked-down networks block WebRTC; if a phone can't
  connect, try another network or the phone's data.
* The host screen shows `Ready · N phones connected` under the QR code so you can see it working before you start.
* If the broker is ever unreachable, the host screen says so. Only introductions are affected: phones already connected keep voting.

## Running the night

1. **Guest details.** The first page. Add each guest's **name** and the **Bollywood character** they are portraying. Use *Add guest*,
   or *Paste a list* (`Name | Character`, one per line). Click **Save details**. They are kept in this browser, so a refresh doesn't lose them.
2. **Best Dressed Award.** After the other awards, open page 2. The QR code is already on screen so guests can scan and pick their name
   while you set up. Choose **2 minutes** or **5 minutes**, then **Start voting**.
3. **Voting.** A countdown runs on the host screen and on every phone. Each guest sees the guest list with names and characters and
   votes for their favourite. Nobody sees any scores: the host only sees names light up as people vote.
4. **Close.** At zero, voting closes by itself and late votes are refused. (**Close voting now** ends it early.)
5. **Reveal Winner.** Click it for the drumroll and curtain. The winner's name and character appear with confetti.

### Ties
A tie is never settled at random. The reveal shows **joint winners** ("It's a tie!"). The host can also choose **Hold a 60-second tie-break**,
which puts only the tied guests on everyone's phone for one more vote.

### Preventing duplicate votes
Guests first tap **their own name**. A name can be picked on one phone only, and each phone votes once (changing a vote replaces it).
That also stops people voting for themselves. It is client-side, so it is honest-system protection: if someone picks the wrong
name or switches phones, open **Options → Release** on the host screen.

## Look and backdrop

Fonts are Rozha One (titles, numbers, winner names) and Plus Jakarta Sans (everything else), loaded from Google Fonts. The palette
is midnight plum with marigold gold, rani pink and a velvet-maroon curtain.

**Stage backdrop (optional).** Save a 16:9 picture (about 1920 x 1080) as `public/img/backdrop.jpg` (`.png` or `.webp` also work).
When it is there, the whole site uses it behind a dark veil: the host screen puts its toolbar under the picture's title sign and keeps
the panels between the side curtains, and phones show the stage-floor area. Without it the site shows a plain stage glow.
Details in `public/img/README.md`.

## Develop

```bash
npm run dev         # static server on http://localhost:8080 (same clean URLs as Vercel: /vote)
npm test            # the voting rules and the phone-to-host link (against a fake PeerJS network)
npm run build:demo  # builds demo/dist/demo.html: both screens side by side with sample guests, no network needed
```

Files: `public/index.html` + `js/host.js` (host app), `public/vote.html` + `js/voter.js` (guest page), `js/core.js` (rules),
`js/p2p.js` (the phone-to-host link), `js/host-runtime.js` (localStorage + link), `vendor/` (QR code and PeerJS, both MIT).
Stored in the host's browser: `bn:state` (guest list, votes, clock), `bn:hostId` (the QR code's connection code), `bn:minutes`.

Designed and developed by [Neelesh Chaudhary](https://neelesh.one).
