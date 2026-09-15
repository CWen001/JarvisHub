from pathlib import Path
import json

out = Path(__file__).parent
out.mkdir(parents=True, exist_ok=True)

families = [
    {
        "slug": "lunar-halo",
        "name": "月晕圆形",
        "architecture": "Build a compact circular watch from four legible levels: a moon-white satin ceramic upper ring; a slim satin midnight-blue metal carrier directly beneath it; a deeper bead-blasted blue structural middle frame extending into the strap pivots; and a narrower matte ink-blue lower shell. Separate each level with one continuous uniform shadow seam. Keep the ceramic non-load-bearing and the metal middle frame visibly responsible for the attachments.",
        "craft": "Use a narrow champagne inner reveal only along the lower-right quadrant. Machine the near pivot seat as a compact six-sided boss around a centred pin. Use one thin champagne button face on a recessed blue backing plate. The strap has broad concentric wave ribs near the case, fine radial microtexture between them, smooth edge bands and a quieter underside.",
        "interface": "Show large white ‘20:26’, one thin incomplete warm-white halo arc, one champagne phase point and ‘MID-AUTUMN’ on near-black. No phase-icon row or analogue dial.",
        "materials": "moon-white satin ceramic, two distinct midnight-blue metal finishes, ink-blue lower shell, matte deep-blue elastomer and restrained champagne metal",
    },
    {
        "slug": "crescent-soft-square",
        "name": "弦月柔方形",
        "architecture": "Use no ceramic. Build a thin softened-square case from a single pale champagne-grey satin metal top plate seated into a separate deep midnight-blue bead-blasted perimeter chassis, above a visibly inset graphite lower tray. Cut one asymmetric crescent-shaped chamfer through only the top plate’s upper-left and lower-right transitions; its ends terminate at real assembly seams. The blue chassis alone extends into short lugless articulated strap joints.",
        "craft": "Use one uniform top-plate seating gap, a narrower lower-tray service seam and crisp planar turns where the crescent chamfer changes direction. Fit one very thin blue side rocker into a separate champagne-grey backing cassette without crossing seams. Give the strap a broad central satin plane, fine diagonal micro-ribs confined to two side fields, smooth edge rails and precise moulded end blocks.",
        "interface": "Show large white ‘20:26’, a bold black-to-white crescent negative space crossing one corner, one small champagne phase marker and ‘MID-AUTUMN’. Keep it fully digital and sparse.",
        "materials": "pale champagne-grey satin metal, bead-blasted midnight-blue metal, graphite lower tray, matte blue elastomer and one restrained warm-gold phase accent",
    },
    {
        "slug": "tidal-ellipse",
        "name": "潮汐横椭圆形",
        "architecture": "Build a clearly horizontal oval watch, wider than tall but still watch-like, from a smoked transparent glass canopy seated over a dark inner display carrier. Clamp that carrier between two separate champagne-grey metal side frames, left and right, each terminating in its own compact pivot block. A narrow midnight-blue lower cradle connects the side frames beneath the display and remains visibly inset. Avoid a circular case or capsule fitness tracker.",
        "craft": "Show continuous canopy seating, precise side-frame end joints and one clean lower-cradle seam. Use one thin dark-blue paddle recessed into the right metal frame. Shape the pivot blocks with short faceted transitions rather than round blobs. The strap begins broad at the two side-frame pivots, tapers decisively, and uses alternating smooth tide bands and fine transverse micro-ribs with open-ended underside channels.",
        "interface": "Show large white ‘20:26’ arranged horizontally, one broad warm-white tidal crescent flowing left to right, a small champagne phase point and ‘MID-AUTUMN’. No city map, analogue marks or dense data.",
        "materials": "smoked transparent glass, champagne-grey satin side frames, midnight-blue inner carrier and lower cradle, matte blue elastomer and minimal warm-gold detail",
    },
    {
        "slug": "osmanthus-octagon",
        "name": "桂影柔八角形",
        "architecture": "Build a softened-octagonal watch around a dark midnight-blue central display carrier and exactly four independent pale champagne-grey metal corner blocks. Each block wraps one diagonal corner, seats into a matching stepped pocket and contributes two of the eight outer facets. A separate narrow ink-blue lower shell sits inset below the carrier. The corner blocks never merge into one decorative bezel.",
        "craft": "Give all four blocks identical pocket seams and restrained eight-sided surface turns, with one tiny warm-gold retaining detail at each structural boundary rather than a screw field. Integrate one thin hexagonal-faced side button into the right block on a separate dark backing plate. Use compact faceted pivot bosses in the central carrier. The strap combines a quiet central plane, sparse branching micro-ribs inspired by leaf veins without drawing leaves, smooth edge bands and a refined underside.",
        "interface": "Show large white ‘20:26’, one quiet warm-white moon disc, exactly four sparse gold points aligned with the diagonal corner rhythm and ‘MID-AUTUMN’. No literal flower, rabbit or analogue dial.",
        "materials": "bead-blasted midnight-blue central metal, pale champagne-grey satin corner blocks, ink-blue lower shell, matte blue elastomer and tiny warm-gold retention accents",
    },
    {
        "slug": "night-spine-rectangle",
        "name": "夜阑长方形",
        "architecture": "Build a slim vertical-rectangular watch from a moon-white precision-polymer front shell, two separate midnight-blue metal side rails and one continuous champagne-grey structural spine visible through the centre of the lower case. The spine extends into compact upper and lower pivot yokes while the polymer shell remains non-load-bearing. A narrow dark lower tray is inset between the rails. Keep the form a watch, not a small phone or fitness capsule.",
        "craft": "Show distinct shell-to-rail seams, rail-to-tray seams and the spine’s clean transitions into both yokes. Use short six-sided pivot seats and one thin midnight-blue side toggle mounted in a separate rail cassette. The composite strap has a fine woven-looking outer microtexture moulded into elastomer, one smooth structural centre strip, sealed edge bands and a smooth patterned underside; it remains a complete flexible strap, not fabric.",
        "interface": "Stack large white ‘20’ over ‘26’, let one thin warm-white crescent cross the numeral division, add one champagne phase point and ‘MID-AUTUMN’. Preserve generous edge clearance and no analogue cues.",
        "materials": "moon-white satin precision-polymer impression, midnight-blue bead-blasted rails, champagne-grey satin structural spine, graphite lower tray and deep-blue textured elastomer",
    },
]

standard_evidence = [
    "watch-base-model:concept-image@1.0.6",
    "watch-knowledge-catalog@0.2.0",
    "watch-atom:watch-family-fit-first@sha256:e71fe9cfc27f74bc27be0400912c9d9ec2a815ecb770daf4c233ece4d881faf4",
    "watch-atom:watch-material-zoning-purpose@sha256:f6ad7222ffc44c364212f706cb9e5c5dc9e0960057fefabf91447da3b7ae496d",
    "watch-atom:watch-finish-hierarchy@sha256:c0a92334357b1172ce653dab17198363165462d401eff39ae190b60dee7b7871",
    "watch-atom:watch-seam-fastener-legibility@sha256:6b383e2bec93c11212a2982ecd84b85b2b552abe9f50c76ce4546055002b2aaf",
]
small_evidence = [
    "watch-base-model:concept-image@1.0.6",
    "watch-knowledge-catalog@0.2.0",
    "watch-atom:watch-family-fit-first@sha256:e71fe9cfc27f74bc27be0400912c9d9ec2a815ecb770daf4c233ece4d881faf4",
    "watch-atom:watch-mass-close-to-wrist@sha256:3040f824583bc46ab3bb131b65f9f8df1eed2d86646e9e1e8ff55ff88777bb4f",
    "watch-atom:watch-small-wrist-articulation@sha256:4617708934a1d0a2e59ed3855c8362f440c1b06790b7f45e8d2667cd8ca66b10",
    "watch-atom:watch-seam-fastener-legibility@sha256:6b383e2bec93c11212a2982ecd84b85b2b552abe9f50c76ce4546055002b2aaf",
]

records = []
for family_index, f in enumerate(families, 1):
    standard_index = family_index * 2 - 1
    small_index = family_index * 2
    standard_prompt = f"""Create exactly ONE complete premium DIGITAL smartwatch: the standard-wrist {f['name']} member of a diverse 2026 Mid-Autumn collection.

DESIGN IDENTITY
Interpret Mid-Autumn through precision, moonlight and changing phase, not literal rabbits, mooncakes, palaces, lanterns or souvenir graphics. This family must be visibly distinct from ceramic halo, generic soft-square and conventional round smartwatch clichés.

COMPOSITION
Show one complete connected watch in a lower front-right three-quarter hero view, camera near the middle-frame height so top transitions and side assembly are both inspectable. Use natural perspective, keep the far side occluded, and include the full case, control, both articulated joints, full open-loop strap, holes, keeper and complete buckle. Pale warm-grey studio background, cool key, neutral fill, narrow warm rim, controlled glass reflection and grounded shadow. No wearer, prop, second watch, panel, crop, logo or watermark.

ARCHITECTURE
{f['architecture']}

CRAFT DETAIL
{f['craft']} Use even seating gaps, aligned pivots, clean insert termination and distinct finish hierarchy. The standard-wrist version uses balanced case presence, moderate strap width and short articulated joints with relaxed immediate drop.

CMF
Use {f['materials']}. Every material boundary follows a visible part boundary. Keep warm-gold accents below five percent and large surfaces quiet.

INTERFACE
{f['interface']}

RENDER INTEGRITY
Make glass, case levels, control backing, pivot bosses, moulded strap transitions, keeper and separate buckle frame/tongue/pin visibly coherent. Avoid monolithic-looking construction, painted fake seams, thick controls, coarse generic texture, malformed facets, impossible joints, incomplete closure, extra products, analogue hands, logos, watermark or unsupported claims.
"""
    small_prompt = f"""Edit the supplied standard-wrist reference into exactly ONE complete slender-wrist version of the SAME {f['name']} DIGITAL smartwatch.

PRESERVE
Preserve the exact product identity, architecture, materials, interface, part count, seam logic, control construction, craftsmanship, strap pattern, buckle, lower front-right camera angle, lighting and background. Do not redesign the family or borrow shapes from another watch.

ONLY CHANGE — SLENDER-WRIST FIT
Visibly reduce upper-case and bezel mass while retaining every identity-bearing transition. Narrow the strap slightly, shorten all rigid attachment spans, move each pivot closer to the case mass and use a compact near-case articulated connector. Both first strap segments must turn downward immediately through a progressive curve. Narrow and inset the lower shell so the watch reads lower and lighter. Preserve practical strap width at the reinforced end blocks, precise holes, keeper and complete buckle. Do not simply scale down a heavy ring, create long traditional lugs or turn the watch into a fitness capsule.

CRAFT RETENTION
Retain every approved material boundary and uniform seam. Preserve the standard member’s face transitions, thin control with separate backing, polygonal machining where present, two-scale strap texture, smooth edge bands, underside pattern, aligned pivots and separately constructed buckle. Natural perspective must govern near and far parts.

Show one coherent complete watch only. Avoid changed CMF, lost texture, simplified monolithic sidewalls, thick controls, malformed joints, missing closure, extra products, panels, logos, watermark or unsupported claims.
"""
    for index, fit, prompt, evidence in (
        (standard_index, "standard", standard_prompt, standard_evidence),
        (small_index, "small", small_prompt, small_evidence),
    ):
        prompt_file = f"{index:02d}-{f['slug']}-{fit}.txt"
        output_file = f"{index:02d}-{f['slug']}-{fit}.png"
        (out / prompt_file).write_text(prompt, encoding="utf-8")
        records.append({"index": index, "family": f["name"], "fit": fit, "prompt": prompt_file, "output": output_file, "sourceEvidence": evidence})

(out / "generation-plan.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {len(records)} prompts")
