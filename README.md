# 🎁 White Elephant Exchange

A host app for running a White Elephant gift swap on the big screen.

**Live:** https://myreknight.github.io/white-elephant/

## How it works

1. **Setup**: add players (the list order is the turn order; there's a Shuffle button) and gifts.
   Each gift has two images:
   - **Mystery**: what everyone sees while it's wrapped (a photo of the wrapped gift, or anything you like). Skip it and you get a wrapped-box design.
   - **Gift**: revealed when someone opens it. It stays blurred in Setup until you hover, so you don't spoil anything.
2. **Play**: put it on the TV or projector (there's a Fullscreen button). The banner shows whose turn it is.
   - Click a wrapped box to open it for the current player. You get a shake, flip and confetti reveal.
   - Click an opened gift to steal it. The person who lost it goes next.
3. When every gift is open, the game ends (or player 1 gets a final swap, if that rule is on), and **See who got what** shows the results.

### House rules (Setup → House rules)
- **Max steals per gift** (default 3). After that a gift is locked with whoever has it. Set to 0 for no limit.
- **No immediate steal-backs**: someone who was just robbed can't take the same gift straight back.
- **Player 1 gets a final swap** once all gifts are open.

### Host controls
- **Undo** (or Ctrl/⌘+Z) reverses any move, including resets.
- **•••** on any gift: assign it to any player (or re-wrap it) and adjust its steal count.
- Click a name in the turn order to hand that person the turn.
- **Skip** passes over the current player.
- Players and gifts can be added mid-game for late arrivals.

## Where your data lives

Everything (names, photos, game progress) is stored **in the browser you set it up in** (localStorage + IndexedDB). Nothing is uploaded anywhere, and the GitHub repo contains only the app code.

- To move a setup to another computer: **Setup → Export backup**, then **Import backup** on the other machine.
- Two windows of the app in the same browser stay in sync. You can control from your laptop screen while a second window sits fullscreen on the projector, and reveals play on both.

## Running locally

It's plain HTML/CSS/JS with no build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.
