# Bollywood Night — live "Best Dressed" voting

A website for a party vote. The host opens `/host` on a laptop and shares that screen on the projector. Guests scan the QR code
on their own phones (any network, no WiFi pairing), tap their name and vote. The projector shows who's winning live, then a
curtain reveals the winner. No accounts, no app.

* **Guests:** `https://<your-site>/` (this is what the QR code points to)
* **Host / projector:** `https://<your-site>/host`

## Put it online (Vercel, about 10 minutes, free plan)

Vercel runs functions, not a long-lived server, so state lives in a small Redis database (Upstash, free). Each vote is its own
Redis field, so 20 people voting at once can't overwrite each other, and phones are updated by polling every couple of seconds.

1. **Vercel → Add New → Project → import this GitHub repo.** Set **Root Directory** to `bollywood-vote`. Click **Deploy**.
2. In the project, **Storage → Create Database → Upstash Redis** (free plan) and connect it to the project.
   This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. **Deployments → Redeploy** (new variables only apply to new deployments).
4. Open `https://<your-project>.vercel.app/host`. Until step 2 and 3 are done it shows a "Finish setup" card.

There is no password. Only share the main address with guests (the QR does this); keep `/host` to yourself. If you want a lock anyway,
add an environment variable `HOST_KEY` in Vercel and open `/host?key=<that value>`.

## Running the night

1. **Guest list.** The first host screen is **Who's coming?**: type one guest per line (`Name | Character`; the character is optional)
   and save. **Edit names** reopens it until voting starts.
2. **Ready.** The list is on screen while you run the awards. Guests see nothing yet.
3. **Start voting.** The QR code appears with a **5:00 clock** (change it in Settings). Guests scan, tap their own name, vote.
   The leaderboard updates live. Voting closes at zero or when everyone has voted. **+1 min** and **Close now** are in the control bar.
4. **Reveal.** The curtain hangs closed over "Voting closed". Press **Reveal winner**: drumroll, curtain opens, confetti.

Move the mouse to show the control bar; it hides itself after a few seconds. Untick **Live standings** to hide the leaderboard
until the reveal.

### There is never a tie
If two or more people finish level at the top, **Reveal winner** doesn't reveal. It starts a **60-second tie-break** instead: phones
switch to a ballot with only the tied people, and the projector shows them head to head with live counts. If the tie-break is level
too, a random draw picks one. So there is always exactly one winner (or none, if nobody voted).

### Rules the app enforces
* One vote per person. Guests pick **who they are** first, so nobody can vote for themselves or vote twice.
  A name can be claimed by one phone only; if someone picked wrong or switched phones, **Settings → Guests → Release**.
* Guests can change their vote until the clock runs out.
* **Settings → Reset everything** wipes names and votes. Do a dry run with the sample names first, then reset.

## Try it without deploying

`npm run build:demo` builds `demo/dist/demo.html`: the real guest and host screens side by side in one page, wired to the same
voting rules (`lib/core.js`) with dummy guests you can trigger. No server needed; open `demo/dist/standalone.html` in a browser.

## Run it on one laptop instead (optional)

```bash
node server.js     # Node 18+; prints the host link and a WiFi address for the QR code
```

This mode needs phones on the same WiFi as the laptop, and the laptop itself counts as the host. It keeps state in
`data/state.json`. Set `PUBLIC_URL=https://…` when exposing it through a tunnel (the host link then carries a key).

## Tests

```bash
npm test      # rules (timer, tie-break), the Redis store, the Vercel function, the Node server
```
