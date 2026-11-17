# In-game versions — handoff notes

Notes for picking up work on running this White Elephant exchange **inside a game**, written 2026-11-16 after research on a Mac that doesn't have the games. The next step happens on the group's gaming PC, which has **Big Walk** and **Rust** installed. The group is **PC-only**, so ignore console and crossplay.

Nothing here has been tested in either game yet. Treat the game-specific facts as leads to verify.

---

## 1. How the web app works today

- Static site, no build step: `index.html`, `styles.css`, `app.js`. Live at https://myreknight.github.io/white-elephant/
- **All data is browser-local.** Game state is in `localStorage` (key `white-elephant/state/v1`). Photos are Blobs in IndexedDB (`white-elephant` → `images`, keys `box:<giftId>` / `gift:<giftId>`). Nothing is online, so **no game mod can read the web app yet** (see section 2).
- Game rules as implemented (port these as-is so every version plays the same):
  1. **Random turn order** drawn at start (setting `randomOrder`, default on).
  2. On your turn: **open** a wrapped gift, or **steal** an opened one.
  3. A **robbed player acts next** (open or steal), then the turn passes to the next player in order who doesn't hold a gift.
  4. **No immediate steal-back** (`noStealBack`): the robbed player can't take the gift they just lost.
  5. **One steal per player per turn** (`oneStealPerTurn`): someone who already stole during this numbered turn and is robbed again must open.
  6. **Lock after N steals** (`maxSteals`, default 3; 0 = unlimited). A locked gift stays with its owner.
  7. **Final swap** (`finalSwap`): once every gift is open (or everyone has gone), player 1 may swap once with any unlocked gift, unless their own gift is locked. Then the game is over.
- Where the logic lives in `app.js` (line numbers approximate):

  | Function | ~Line | What it does |
  |---|---|---|
  | `freshState` | 169 | settings defaults + state shape |
  | `usedSteal` / `canSteal` | 220 | steal eligibility (locks, steal-back, one-per-turn) |
  | `finish` / `nextTurn` | 248 | turn advancement, final round, game over |
  | `startGame` | 311 | random draw, creates `state.game` |
  | `doOpen` / `doSteal` | 341 | the two moves; steal handles chains + swaps |
  | `applyAssign` | 383 | host override (reassign a gift) |
  | `moveFor` | 738 | what clicking a gift means right now, + reason text |

- `state.game` shape:
  ```js
  {
    phase: 'playing' | 'final' | 'over',
    order: [playerId, ...],        // turn order
    turn: 0,                       // index into order of the current numbered turn
    active: playerId,              // who must act now (may be a robbed player)
    reason: 'turn' | 'robbed' | 'final' | 'host',
    blocked: giftId | null,        // no-steal-back target for `active`
    stoleThisTurn: [playerId, ...],
    gifts: { [giftId]: { opened, owner, steals } },
    log: [{ t, text }],
    lastEvent: { id, type: 'draw' | 'open' | 'steal' | 'swap', gift, by, from, at }
  }
  ```

## 2. Shared prerequisite: a live feed

The **Big Walk overlay**, and any **Rust plugin that mirrors the web app**, both need the web app to publish its state online. Proposed approach:

- Add a small hosted backend (any free-tier realtime DB or tiny API). The host's browser writes state and the mods read it.
- Photos must be **hosted at real URLs** so mods (and Rust's sign and UI image loaders) can fetch them. Today they're local Blobs, so upload them on save.
- A read-only JSON snapshot for mods, flattened so they don't need the rules engine:
  ```json
  {
    "title": "Office Holiday Party",
    "phase": "playing",
    "headline": "Jordan, you've been robbed!",
    "subline": "Open a mystery gift or steal another one — just not the Fuzzy socks.",
    "active": "Jordan",
    "players": [{ "name": "Avery", "num": 1, "holding": "Board game", "now": false }],
    "gifts": [{ "num": 1, "name": "Fuzzy socks", "opened": true, "owner": "Priya",
                "steals": 2, "locked": false, "giftImage": "https://…", "boxImage": "https://…" }],
    "lastEvent": { "id": "…", "type": "steal", "text": "Priya stole the Fuzzy socks from Jordan!", "image": "https://…" }
  }
  ```
  Mods poll it every 1–2 s and react when `lastEvent.id` changes.

This part doesn't need either game and can be built and tested anywhere.

## 3. Big Walk

**Facts gathered (unverified on the PC):** House House / Panic, released 2026-08-04, online co-op for 2–12 players with proximity voice. **No official mod tools, SDK or Steam Workshop.** A community mod scene uses **BepInEx**, with mods distributed on **Thunderstore** and **Nexus Mods** (e.g. "Big Voice", a host-only "NoClip"). Fan sites warn that mods touching networking or player limits can break joins after updates.

**Recommended approach: a display-only overlay.** Each player's client polls the feed (section 2) and draws its own panel. It doesn't touch game networking, so players without the mod are unaffected.

**First steps on the PC:**
1. **Mono or IL2CPP?** In the Big Walk install folder (Steam → Manage → Browse local files):
   - `<Game>_Data/Managed/Assembly-CSharp.dll` exists → **Mono**. Use BepInEx 5; decompile with ILSpy or dnSpyEx. Easiest case.
   - `GameAssembly.dll` + `<Game>_Data/il2cpp_data` → **IL2CPP**. Use BepInEx 6 (IL2CPP build) with Il2CppInterop; harder.
2. Install BepInEx (or the "Easy Big Walk Mod Manager" from Nexus), run the game once, and confirm `BepInEx/LogOutput.log` shows the game loading.
3. Download an existing Big Walk mod from Thunderstore and copy its project setup (target framework, references, plugin attributes).
4. Hello-world plugin: a hotkey-toggled `OnGUI` panel with static text. Confirm it renders in the game and doesn't break joining a session.
5. Swap the static text for the live feed: fetch with `UnityWebRequest` in a coroutine (or `HttpClient` on a background thread), and show the headline, whose turn it is, and the latest event, with an image if feasible.
6. Only after that: anything in the game world (screens on objects, physical gift boxes). Those need scene and network knowledge, plus every player running the same mod version.

## 4. Rust

**Facts gathered (unverified on the PC):**
- **Server-side plugins in C#** via **Oxide/uMod** or **Carbon** (a vendor blog suggests Carbon for new servers). Players install nothing.
- **UI on every player's screen** via CUI. Carbon's Lightweight UI has `CreateUrlImage` for images from a URL; on Oxide, use the **Image Library** plugin and reference images by ID.
- **Photos on in-game signs** via the **Sign Artist** plugin: chat `/sil <url>` (needs the `signartist.url` permission), or the API `API_SkinSign(BasePlayer player, Signage sign, string url, bool raw = false)`.
- **Proximity voice is built into Rust.**
- Facepunch's guidelines require gameplay-changing servers to be listed as **modded**. Rust force-updates on the **first Thursday of each month**, and plugins may need updates afterwards, so don't schedule the party right after one.
- The Rust dedicated server runs on **Windows/Linux** (the Steam tool ID is 258550, from memory; verify it).

**Two ways to build it:**
- **Native plugin (recommended to start):** the plugin owns the game. Port the rules from section 1 into C#. Gift boxes are entities players walk up to; reveals and turn status go in a CUI panel; gift photos go on signs. It only needs hosted image URLs, not the full live feed.
- **Mirror plugin:** the plugin reads the live feed (section 2) and only displays. Simpler code, but it needs the backend first and the host still runs the game from the web app.

**First steps on the PC:**
1. Install the Rust dedicated server with SteamCMD into its own folder and start it locally (small map, `+server.secure 0` for testing is a common choice; check what the current client accepts).
2. Install Carbon (or Oxide) on it and confirm a sample plugin loads.
3. Connect from the Rust client (F1 console → `client.connect 127.0.0.1:28015`).
4. Prototype: `/we start` draws a random order, a CUI panel shows "X's turn", `/we open <n>` and `/we steal <n>` run the rules, and Sign Artist's API puts a test image on a sign.
5. Then replace chat commands with interacting with physical boxes and signs.

## 5. Ruled out or parked
- **PEAK:** no official mod tools (Landfall declined Workshop support); same situation as Big Walk.
- **Skyrim:** single-player at heart; multiplayer only through the fan mod Skyrim Together Reborn, which has uncertain custom-script sync.
- **Minecraft (Java, Paper plugin):** strong fallback. Players install nothing, images can go on maps from a URL (ImageCanvas), and proximity voice is available through the Simple Voice Chat mod. Testable on a Mac.
- **Garry's Mod:** easiest way to put the actual web page on an in-game screen (built-in HTML panels, the WBUI addon).

## Sources
- Big Walk: [Wikipedia](https://en.wikipedia.org/wiki/Big_Walk) · [Steam](https://store.steampowered.com/app/1478500/Big_Walk/) · [Easy Big Walk Mod Manager](https://www.nexusmods.com/bigwalk/mods/24) · [Thunderstore list (fan site)](https://bigwalkmods.wiki/all-mods-list) · [mod safety notes (fan site)](https://bigwalk.online/mods)
- Rust: [uMod GUI basics](https://umod.org/guides/rust/basic-concepts-of-gui) · [Carbon Lightweight UI](https://docs.carbonmod.gg/devs/core/lightweight-ui) · [Sign Artist](https://umod.org/plugins/sign-artist) · [Facepunch server guidelines](https://support.facepunchstudios.com/hc/en-us/articles/360009062817-Guidelines-for-community-servers-using-plugins-mods) · [Rust server rule considerations](https://www.corrosionhour.com/rust-server-rule-considerations/)
- Others: [PEAK FAQ](https://landfall.se/peak-faq) · [Skyrim Together Reborn](https://www.nexusmods.com/skyrimspecialedition/mods/69993) · [ImageCanvas](https://modrinth.com/plugin/imagecanvas) · [Simple Voice Chat](https://www.curseforge.com/minecraft/bukkit-plugins/simple-voice-chat) · [GMod HTML panel](https://wiki.facepunch.com/gmod/HTML)
