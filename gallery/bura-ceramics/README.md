# AABC Bura Ceramics — Gallery Research Panels

Source content for a set of gallery wall panels/posters about the **Bura-Asinda-Sikka
terracotta culture** (Niger River valley, c. 3rd–13th century CE), built to support the
display around the AABC Bura clay jar-top face artefact.

## Files

| File | Purpose |
|---|---|
| [panels.json](panels.json) | The content data — one record per poster (A–F). The display binds to these fields. |
| [panel.schema.json](panel.schema.json) | JSON Schema (draft-07) describing/validating the panel records. |
| [README.md](README.md) | This file — schema overview, panel list, and production caveats. |

## The metadata schema

Each panel record carries everything a poster needs to render:

| Field | Meaning |
|---|---|
| `id` | Short panel code (A–F) — wall order. |
| `name` | Stable kebab-case key the display binds to. |
| `title` / `subtitle` | Poster headline and secondary line. |
| `format` | Intended visual treatment (e.g. "Sepia topographic illustration"). |
| `panelCaption` | One-line standfirst. |
| `description` | Primary readable block (~40–80 words). |
| `body` | Optional longer narrative / back-of-card text. |
| `keyFacts` | Bulleted facts for a sidebar or fact strip. |
| `images` | `{ url, caption, credit, license, role }` — `role` ∈ `hero` \| `supporting` \| `reference`. |
| `sources` | `{ name, title, url, publisher }` — at least one **source link** per panel. |
| `design` | Hints for the panel designer: `palette`, `layout`, `illustration`. |
| `status` | `draft` \| `needs-image-clearance` \| `needs-illustration` \| `ready`. |

The top-level `collection` object holds shared metadata: title, anchor artefact, purpose,
version, `curatorialNotes`, and the `imageLicensingPolicy`. A `bibliography` array collects
the key references.

## The panels

| Panel | Title | Format | Status |
|---|---|---|---|
| **A** | A Bend in the Niger — site location & geography | Sepia topographic illustration | needs-illustration |
| **B** | The Village of the Dead — Boubé Gado & the 1983 excavation | B&W archival photo | needs-image-clearance |
| **C** | Forms of the Bura Potter — ceramic typology | Line-drawing typology grid | needs-illustration |
| **D** | Sealed for the Afterlife — burial context | Cross-section diagram | needs-illustration |
| **E** | A Corridor of Clay — West African terracotta network | Map + timeline infographic | needs-illustration |
| **F** | From Niger Soil to the Vitrine — holdings & provenance | Text + institution panel | draft |

## Production caveats (read before printing)

These are recorded in `collection.curatorialNotes` and `collection.imageLicensingPolicy`
in [panels.json](panels.json):

1. **Dating is inconsistent across sources.** Wikipedia/UNESCO say "first-millennium";
   galleries say 3rd–13th c. CE; the Mulvane Art Museum cites 2nd–11th c. CE from
   stratigraphy. Panels use **"c. 3rd–13th century CE"** — finalise against Gado (1993).
2. **Discovery & excavation.** Found by accident in **1975**, first small dig **1978**,
   systematic excavation **1983** by **Boubé Gado** (IRSH, University of Niamey); ~630
   funerary urns. Some sources name the finder as villager Abdurahman Sindy.
3. **Coordinates differ.** Wikipedia: **13°53′53″N 1°02′20″E**; Grokipedia: ~13°50′N 0°30′E.
   Verify against Niger heritage records before printing a precise map pin.
4. **Image rights are NOT cleared.** URLs in `images[]` are research references only.
   Auction-house and commercial-gallery images must not be reproduced. Prefer
   **open-access** (Wikimedia Commons, museum open-access) or **commission original
   illustrations** for panels A, C, D, E. Confirm credit/licence for every image.
5. **Looting context.** ~90% of Niger's Bura sites have been damaged since 1994 (Le Monde);
   Bura objects appear on the **ICOM Red List**. Panel F leans into this responsibly —
   keep provenance framing front and centre.

## Research method

Compiled June 2026 via web research (Tavily search + image retrieval). Primary references
include the African Arts journal article on Bura funerary urns, the Mulvane Art Museum 2024
exhibition, the Smithsonian's 2001 "Archéologie au Niger", Yale University Art Gallery
records, ICOM's Red List, and Wikipedia/UNESCO. See `bibliography` in
[panels.json](panels.json).
