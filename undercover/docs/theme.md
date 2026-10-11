# Mafia Game Website — Character & Environment Theme

## 1. Creative Direction

**Theme:** Monochrome cinematic noir  
**Mood:** Dark, misty, mysterious, tense, atmospheric  
**Visual style:** Classic mafia-film silhouettes, dramatic backlighting, deep shadows, wet streets, drifting fog, and restrained silver highlights.

The website should feel like entering a secret city where nobody can be fully trusted. Keep the visual language grayscale only: black, charcoal, graphite, steel gray, smoke gray, and silver-white. Avoid colored accents, colorful glows, or saturated lighting.

### Core palette

| Token | Suggested value | Usage |
|---|---|---|
| Void Black | `#050607` | Main page background |
| Near Black | `#0B0D0F` | Panels and overlays |
| Charcoal | `#151719` | Cards and surfaces |
| Graphite | `#25282B` | Borders and raised surfaces |
| Fog Gray | `#777D82` | Mist, secondary details |
| Silver | `#C5C9CC` | Icons, fine outlines, key UI details |
| Moon White | `#F2F3F4` | Important text and highlights |

Use high contrast sparingly. Most of the scene should remain dark, with the characters revealed through edge lighting and fog.

---

## 2. Shared Character Art Direction

All characters belong to the same visual world and should look like they were photographed on the same foggy night.

- **Composition:** Full-body or waist-up character silhouette, centered or slightly off-center.
- **Lighting:** Strong backlight or narrow rim light; faces mostly hidden.
- **Materials:** Wool coats, worn suits, leather gloves, polished shoes, aged metal, and subtle fabric texture.
- **Atmosphere:** Low fog around the feet, fine airborne particles, light film grain, and soft background haze.
- **Background:** Dark neutral gradient with a barely visible noir environment; keep the area behind the character uncluttered.
- **Face treatment:** Mysterious and partially obscured, not cartoonish. Avoid exaggerated fantasy features.
- **Consistency:** Similar camera angle, scale, contrast, grain, and light direction for every role.
- **Color rule:** Strict grayscale only. No red, blue, amber, or other colored light.

### Character card treatment

- Use a dark charcoal card with a subtle silver-gray border.
- Reveal the character artwork through a soft vertical mist layer.
- Show the role name in uppercase, with compact secondary text beneath it.
- On hover, slightly increase contrast, brighten the rim light, and let fog drift across the lower edge.
- Selected state: a thin silver outline and a gentle white-gray glow. Avoid bright neon effects.

---

## 3. Character Themes

### Doctor — The Quiet Observer

**Silhouette:** A reserved figure in a long dark coat over formal clothing, carrying a worn medical bag. Optional stethoscope or medical case detail, kept subtle.

**Visual mood:** Controlled, intelligent, clinical, unreadable.

**Lighting:** A narrow silver rim light outlines the shoulders and medical bag. Keep the face hidden beneath shadow.

**Environment:** A deserted alley near an old clinic, with a blurred doorway and low ground fog.

**Animation:**
- Slow fog movement around the shoes.
- A tiny shift of the medical bag or coat hem.
- Gentle light falloff across the silhouette.
- Idle movement should be minimal and calm.

**Avoid:** Bright hospital whites, modern medical UI, blood effects, or a cheerful doctor illustration.

### Mafia — The Hidden Threat

**Silhouette:** A powerful figure in a tailored suit and fedora, wearing a long overcoat. Hands gloved or hidden in pockets; face obscured.

**Visual mood:** Authority, danger, confidence, secrecy.

**Lighting:** Strong backlight with a crisp silver edge along the hat, shoulder, and coat. The torso stays almost black.

**Environment:** A rain-slick street beside a vintage car, with distant lamps rendered as soft grayscale bokeh.

**Animation:**
- Coat edges shift slightly in the wind.
- Smoke or mist passes behind the shoulders.
- A slow, subtle camera push-in for reveal moments.
- Hover may sharpen the silhouette and increase contrast.

**Avoid:** Visible gore, overt weapon posing, colorful gangster clichés, or exaggerated villain expressions.

### Innocents — The Uncertain Crowd

**Silhouette:** A small group of ordinary townspeople in simple coats, hats, and understated period clothing. Vary heights and shapes so the group feels human.

**Visual mood:** Vulnerability, uncertainty, suspicion.

**Lighting:** Soft diffuse backlight with less contrast than the Mafia character. Keep the group partially lost in fog.

**Environment:** A narrow street or square where distant windows and building edges fade into mist.

**Animation:**
- Fog drifts slowly across the group.
- Tiny, independent posture shifts create a living crowd.
- Background silhouettes fade in and out very gently.
- Keep motion restrained to preserve suspense.

**Avoid:** Identical cloned silhouettes, comedic expressions, or overly bright character details.

### Mr X — The Unknown Presence

**Silhouette:** A lone, ambiguous figure in a hooded coat or high-collared overcoat. No readable face, insignia, or obvious identifying feature.

**Visual mood:** Unknown, elusive, unsettling.

**Lighting:** A pale halo of fog behind the figure, with only a thin outline visible. The center of the silhouette should remain nearly black.

**Environment:** An empty passage disappearing into dense fog; distant architecture should be barely perceptible.

**Animation:**
- The silhouette appears gradually through the mist.
- Fog briefly thickens and conceals the figure, then thins.
- Use a very slow parallax shift to make the background feel deep.
- On reveal, increase the outline contrast for a moment, then settle back.

**Avoid:** Ghostly colors, supernatural symbols, jump scares, or revealing a detailed face.

### Police — The Watchful Authority

**Silhouette:** A detective or police officer in a long coat, structured uniform, or understated period suit. A badge shape may be visible but should not dominate.

**Visual mood:** Vigilance, pressure, investigation.

**Lighting:** A hard overhead or side rim light defines the hat brim, shoulders, and coat. Keep the face in shadow.

**Environment:** A rain-darkened street near an old police station or streetlamp, with faint architectural lines behind the fog.

**Animation:**
- A slow sweep of diffuse light across the background.
- Coat hem moves slightly in the breeze.
- Fine rain and ground mist move at different speeds.
- A restrained light pulse can mark a role reveal, but must remain grayscale.

**Avoid:** Blue-and-red emergency lights, modern tactical gear, bright badges, or action-movie effects.

### Body Guard — The Silent Shield

**Silhouette:** A broad-shouldered figure in a heavy dark suit or long coat, standing upright with hands clasped or held close to the body.

**Visual mood:** Protection, strength, discipline, quiet intimidation.

**Lighting:** Strong rim light across the shoulders and arms; most of the body remains in deep shadow.

**Environment:** A doorway, private club entrance, or car-side setting with thick fog at ground level.

**Animation:**
- Minimal breathing-like movement in the shoulders.
- Slow fog rolling past the lower body.
- Slight coat movement at the edges.
- On selection, reveal the outline with a short, smooth silver-gray light sweep.

**Avoid:** Oversized muscles, superhero posing, exaggerated weapons, or aggressive action loops.

---

## 4. Environment & Atmosphere

### Main environment

Build a layered noir city at night using:
- A distant skyline with old rooftops, towers, chimneys, and narrow streets.
- Wet cobblestones or asphalt with subtle grayscale reflections.
- Vintage cars, crates, iron railings, and old streetlamps as low-detail silhouettes.
- Moonlight filtered through clouds, never a bright fantasy moon.
- Dense fog in the foreground, medium haze in the midground, and softer mist in the distance.

The environment should support the game interface rather than compete with it. Keep important UI zones dark and low-detail.

### Mist layers

Use three independent fog layers to create depth:

1. **Foreground fog:** Broad, soft, low-opacity wisps moving slowly across the bottom of the screen.
2. **Midground haze:** Thinner fog drifting sideways behind the characters.
3. **Background fog:** Almost static atmospheric haze that softens the skyline and creates distance.

Fog should be grayscale, soft-edged, and never fully obscure important buttons or text. Use gradients and masks to blend it into the background.

### Rain and surface reflections

- Use fine, sparse rain rather than a heavy storm.
- Add subtle reflections to wet ground, with low contrast and no colored highlights.
- Keep rain slower and less visible near text-heavy interface areas.
- Reflections should feel imperfect and broken, not mirror-like.

### Lighting

- Use one primary moonlit backlight and a few dim environmental lights.
- Keep light sources grayscale, with silver-white highlights and soft gray falloff.
- Add mild volumetric rays only where fog and light naturally intersect.
- Avoid strong lens flares, neon edges, and excessive bloom.

---

## 5. Motion & Animation System

The motion should feel slow, deliberate, and cinematic—not like a fast action game.

| Element | Recommended motion | Suggested duration |
|---|---|---|
| Background parallax | Very small horizontal/depth shift | 20–40 seconds per loop |
| Foreground mist | Slow lateral drift | 18–30 seconds per loop |
| Midground haze | Drift in the opposite direction | 25–45 seconds per loop |
| Character idle | Tiny coat, shoulder, or posture movement | 4–8 seconds per cycle |
| Character reveal | Fade in with a slight rise through fog | 700–1200 ms |
| Card hover | Small lift and contrast increase | 250–400 ms |
| Role selection | Silver outline fades in smoothly | 200–350 ms |
| Scene transition | Fog thickens, scene dissolves, then clears | 600–1000 ms |

These are starting points, not rigid rules. Prioritize smoothness and avoid obvious looping patterns.

### Motion principles

- Use ease-in-out curves for most transitions.
- Keep movement subtle enough that users notice the atmosphere rather than the animation itself.
- Separate layers moving at different speeds to create depth.
- Do not animate every element at once.
- Avoid constant zooming, rapid flicker, camera shake, and sudden flashes.
- Provide a reduced-motion mode that disables parallax and minimizes looping effects.
- Pause expensive background animation when the page is hidden or the scene is off-screen.

---

## 6. Website UI Integration

### Page background
Use a near-black base with the environment artwork layered behind a dark gradient overlay. Keep the center or main content region darker for readability.

### Character selection
Use a consistent grid of role cards. Each card should have:
- A monochrome character silhouette.
- Role name in uppercase.
- One short role descriptor.
- A subtle border and soft fog overlay.
- Clear selected, hover, disabled, and locked states.

### Text and typography
- Use a strong condensed or editorial sans-serif for role names.
- Use a clean sans-serif for descriptions and controls.
- Use uppercase sparingly for labels and role titles.
- Keep body text silver-gray or off-white against dark surfaces.
- Maintain accessible contrast and clear focus states.

### Interface details
- Borders: thin graphite or silver-gray.
- Dividers: subtle, low contrast.
- Buttons: charcoal surfaces with off-white text and restrained hover highlights.
- Icons: simple monochrome line icons.
- Avoid excessive glassmorphism; use solid dark surfaces where clarity matters.

---

## 7. Image Generation Prompt Template

Use this template to create consistent character artwork for each role:

> Create a cinematic black-and-white film-noir character portrait for a mysterious mafia social-deduction game website. Subject: **[ROLE DESCRIPTION]**. Show a full-body or waist-up human silhouette in understated 1930s-inspired clothing, with the face mostly hidden in deep shadow. Use dramatic silver-gray backlighting, rich blacks, subtle film grain, wet-street atmosphere, layered drifting fog, and a dark urban night background. High contrast, realistic cinematic photography, restrained composition, elegant and ominous mood, grayscale only. No color, no text, no logos, no UI, no watermark. Keep the silhouette readable at small sizes and leave some dark negative space around the subject.

### Role descriptions to substitute
- **Doctor:** Reserved figure in a long coat carrying a worn medical bag.
- **Mafia:** Confident figure in a tailored suit, fedora, and long overcoat.
- **Innocents:** Small group of ordinary townspeople in understated coats and hats.
- **Mr X:** Anonymous figure in a high-collared coat, face completely unreadable.
- **Police:** Watchful detective in a long coat with a subtle badge silhouette.
- **Body Guard:** Broad-shouldered figure in a heavy suit, standing protectively and still.

---

## 8. Quality Checklist

- [ ] Strict grayscale palette; no colored lights or accents.
- [ ] All six roles share the same lighting, camera, grain, and atmosphere.
- [ ] Silhouettes remain readable against dark backgrounds.
- [ ] Fog has multiple depth layers and moves at different speeds.
- [ ] Background detail does not reduce text or control readability.
- [ ] Character motion is subtle, slow, and non-distracting.
- [ ] Hover, selected, focus, and disabled states are clearly distinguishable.
- [ ] Reduced-motion support is included.
- [ ] Animation performance is considered on mobile devices.
- [ ] No gore, unnecessary weapon emphasis, or cartoonish character styling.

**Final direction:** Make the game feel like a living black-and-white crime film: fog moving through a silent city, figures emerging from shadow, and every role carrying a different kind of mystery.
