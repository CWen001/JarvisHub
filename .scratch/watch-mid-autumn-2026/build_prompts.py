from pathlib import Path
import json

out = Path(__file__).parent

models = [
    {
        "slug": "lunar-halo",
        "name": "Lunar Halo",
        "case": "a compact circular case with a continuous moon-white satin ceramic upper ring, a thin midnight-blue metal chassis, a large circular digital display, and a softly narrowed lower case. The ceramic ring is broad enough to establish one calm halo but has no physical hour marks or decorative gem setting",
        "signature": "one continuous crescent-shaped champagne-gold inner chamfer occupying only the lower-right quarter of the ceramic-to-glass boundary",
        "interface": "a near-black circular screen with large white time ‘20:26’, one thin warm-white lunar-phase arc, a small gold phase marker, and the short date line ‘MID-AUTUMN’. Keep it unmistakably digital and free of analogue hands",
    },
    {
        "slug": "moon-gate",
        "name": "Moon Gate",
        "case": "a thin softened-square case with a moon-white satin upper frame, a midnight-blue inset side chassis, a large rounded-square digital display, and a lower case that tapers inward. The outer frame corners are calm and continuous, while the inner display opening uses a slightly rounder radius to create a restrained gate-like depth",
        "signature": "one narrow champagne-gold reveal visible only between the white upper frame and blue chassis along the lower edge",
        "interface": "a near-black rounded-square screen with large white time ‘20:26’, one cropped warm-white circle rising from the lower edge, a small gold phase marker, and the short date line ‘MID-AUTUMN’. No analogue hands or physical dial indices",
    },
    {
        "slug": "tidal-ellipse",
        "name": "Tidal Ellipse",
        "case": "a restrained horizontal-oval case with a moon-white satin upper shell, a slim midnight-blue structural waist, a wide oval digital display, and a narrowed curved lower case. Keep the oval compact rather than stretched like a capsule tracker, with no traditional lugs extending beyond the silhouette",
        "signature": "one slim champagne-gold crescent insert following only the lower-left outer curve and terminating cleanly before the strap attachment",
        "interface": "a near-black oval screen with large white time ‘20:26’, one broad flowing warm-white crescent line, a small gold phase point, and the short date line ‘MID-AUTUMN’. Keep all information sparse and digital",
    },
    {
        "slug": "osmanthus-octagon",
        "name": "Osmanthus Octagon",
        "case": "a compact softened-octagonal case with eight deliberate but gentle facets, a moon-white satin upper frame, a midnight-blue metal middle chassis, a large rounded-octagonal digital display, and a visibly narrower lower case. Facets must align cleanly across layers without exposed decorative screws or aggressive sports-watch bulk",
        "signature": "exactly four tiny champagne-gold facet reveals placed at alternating diagonal transitions, each following a real material boundary rather than appearing as applied ornament",
        "interface": "a near-black rounded-octagonal screen with large white time ‘20:26’, one quiet warm-white moon disc, four sparse gold points echoing the diagonal facet rhythm, and the short date line ‘MID-AUTUMN’. No literal flower drawing, analogue hands, or physical indices",
    },
    {
        "slug": "night-passage",
        "name": "Night Passage",
        "case": "a slim vertical-rectangular case with strongly softened corners, a moon-white satin upper frame, a narrow midnight-blue structural sidewall, a tall digital display, and a lower case that tapers inward. Keep the proportions watch-like and balanced, not phone-like or fitness-band-like",
        "signature": "one narrow champagne-gold vertical reveal recessed into the lower half of the right chassis edge, interrupted cleanly by the control boundary",
        "interface": "a near-black vertical screen with large stacked white time ‘20’ over ‘26’, one warm-white crescent crossing the division between the numerals, a small gold phase marker, and the short date line ‘MID-AUTUMN’. Keep it sparse and digital",
    },
]

common_standard = (
    "This is the standard-wrist member of a paired family. Keep a balanced everyday case presence, a moderate-width strap, short articulated strap joints, immediate but relaxed first-segment drop, and a visually narrow lower case."
)
common_small = (
    "This is the slender-wrist member of a paired family. Preserve the exact same identity and signature as the standard member, but visibly reduce upper-case and bezel mass, narrow the strap slightly, shorten every rigid attachment span, use a compact near-case articulated connector, and make both first strap segments turn downward immediately. Do not merely miniaturize a heavy upper ring."
)

standard_evidence = [
    "watch-base-model:concept-image@1.0.6",
    "watch-knowledge-catalog@0.2.0",
    "watch-atom:watch-family-fit-first@sha256:e71fe9cfc27f74bc27be0400912c9d9ec2a815ecb770daf4c233ece4d881faf4",
    "watch-atom:watch-color-identity-restraint@sha256:bd94bc063c27cee202e59e54dbdbc55d4449c11c28446dfc6c29b936ce679b6c",
    "watch-atom:watch-no-ornament-without-role@sha256:549e6a538c35a0d9431ec4a190d051d50c89c754a5e62f4973f287804bccf67d",
]
small_evidence = [
    "watch-base-model:concept-image@1.0.6",
    "watch-knowledge-catalog@0.2.0",
    "watch-atom:watch-family-fit-first@sha256:e71fe9cfc27f74bc27be0400912c9d9ec2a815ecb770daf4c233ece4d881faf4",
    "watch-atom:watch-mass-close-to-wrist@sha256:3040f824583bc46ab3bb131b65f9f8df1eed2d86646e9e1e8ff55ff88777bb4f",
    "watch-atom:watch-small-wrist-articulation@sha256:4617708934a1d0a2e59ed3855c8362f440c1b06790b7f45e8d2667cd8ca66b10",
    "watch-atom:watch-color-identity-restraint@sha256:bd94bc063c27cee202e59e54dbdbc55d4449c11c28446dfc6c29b936ce679b6c",
]

records = []
index = 1
for model in models:
    for fit, fit_text, evidence in (
        ("standard", common_standard, standard_evidence),
        ("small", common_small, small_evidence),
    ):
        prompt = f"""Create exactly ONE premium industrial-design hero image containing exactly ONE complete DIGITAL smartwatch from a coherent 2026 Mid-Autumn launch collection.

VISUAL THESIS
{model['name']} is a contemporary interpretation of moonlight, fullness and changing phases for year-round wear. Express the festival through proportion, light, material boundaries and a restrained digital interface—not literal rabbits, mooncakes, palaces, clouds, calligraphy or souvenir decoration. It must read as a current premium smartwatch rather than a traditional analogue watch or jewellery prop.

COMPOSITION
Show the complete connected watch in one coherent three-quarter front hero view, camera slightly above display height and about 20 degrees toward the right control side, with moderate natural perspective. Keep the full case, glass, control, lower-case transition, both strap joints, both strap segments, adjustment holes, keeper and complete buckle inside frame. Arrange one natural open strap loop. No wearer, hand, festival scenery, lantern, presentation panel, second watch, inset, crop, brand, logo or watermark.

CASE ARCHITECTURE AND FIT
Use {model['case']}. The identity-bearing detail is {model['signature']}. All glass, seams, inserts, controls and attachments align with real part boundaries without overlap or malformed junctions. {fit_text}

CONTROL, ATTACHMENT AND STRAP
Use exactly one compact low-profile champagne-metal pill control recessed into a smooth right-side chassis boundary; no crown, front button or oversized hardware. Connect a complete matte midnight-blue fluoroelastomer strap through short aligned pivots. Keep outer surfaces quiet, inner surfaces smooth, edges rounded, holes precise, one keeper with a tiny gold orientation mark, and one complete bead-blasted champagne-grey pin buckle.

CMF
Use moon-white satin ceramic-like upper surfaces, bead-blasted midnight-blue metal-like structure, deepest black glass and matte midnight-blue strap. Champagne/gold occupies less than five percent and appears only at the named signature boundary, compact control, buckle detail and one interface marker. Material names describe visible impressions only and make no manufacturing or durability claim.

INTERFACE
Show {model['interface']}. Preserve generous edge clearance, one primary read and only essential supporting information. No fake health data, app grid, long copy, dense pseudo-data or generic glowing rings.

LIGHTING
Use the same premium moonlit studio setup across the collection: a pale warm-grey seamless background, soft cool key from upper left, gentle neutral fill, a narrow warm rim revealing the gold signature and case layering, controlled glass reflection away from information, and a grounded soft shadow. Lighting must reveal connections and perspective rather than hide them.

HIGH-COST FAILURES
Avoid incomplete strap or closure, broken perspective, floating glass, duplicated or missing controls, impossible attachment, analogue hands, physical hour markers, literal festival icons, extra products, panels, logos, watermarks or unsupported claims.
"""
        filename = f"{index:02d}-{model['slug']}-{fit}.txt"
        (out / filename).write_text(prompt, encoding="utf-8")
        records.append({
            "index": index,
            "model": model["name"],
            "fit": fit,
            "prompt": filename,
            "output": f"{index:02d}-{model['slug']}-{fit}.png",
            "sourceEvidence": evidence,
        })
        index += 1

(out / "generation-plan.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {len(records)} prompts")
