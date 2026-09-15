from pathlib import Path
import json

out = Path(__file__).parent
out.mkdir(parents=True, exist_ok=True)

concepts = [
    {
        "slug": "liquid-pearl",
        "title": "Liquid Pearl Jewellery Tech",
        "thesis": "an elegant asymmetric oval digital watch with a calm jewellery presence, using flowing pearlescent ceramic volumes and almost no visible hardware",
        "architecture": "Form the case as a softly asymmetric horizontal oval: fuller at the upper-left, tapering toward the lower-right. Float a black oval glass opening inside one continuous warm pearl ceramic top shell. Seat that shell into a very slim rose-silver metal carrier visible as one precise crescent seam. The carrier narrows into two hidden under-case pivots; no traditional lugs. Use a small flush touch-indent on the right ceramic edge instead of a protruding button. Keep a visibly inset satin lower shell.",
        "strap": "Use a complete pale blush elastomer strap made from overlapping soft ribbon-like segments that articulate near the case, then merge into a smooth conventional strap with tiny oval holes, one sculpted keeper and a complete rose-silver jewellery-scale pin buckle. Show precise segment gaps, polished edge rolls and a smooth skin side without resembling a metal bracelet.",
        "interface": "Display one oversized pearl-white time ‘8:08’ floating on deep black, a single soft lilac orbital dot and no other data.",
        "cmf": "warm pearlescent satin ceramic, rose-silver metal, black glass, pale blush elastomer and one tiny lilac accent",
        "camera": "a graceful elevated front-left three-quarter view on a warm ivory seamless surface, with diffuse beauty lighting, one narrow rose rim and soft elliptical shadow",
        "avoid": "traditional watch markers, gemstone decoration, thick bezel, visible screws, generic round case, rigid bracelet, missing buckle or glossy plastic",
        "evidence": ["watch-atom:watch-silhouette-distance-read@sha256:22744f2a0b53d51c020355c3550b7382c6aaadd159a82e862891ca9fb5b57e95", "watch-atom:watch-lugless-articulation@sha256:575930f155d47e60d23e20d87df2ce1afc67412c86130eaf26575c110661c0a8", "watch-atom:watch-material-zoning-purpose@sha256:f6ad7222ffc44c364212f706cb9e5c5dc9e0960057fefabf91447da3b7ae496d", "watch-atom:watch-finish-hierarchy@sha256:c0a92334357b1172ce653dab17198363165462d401eff39ae190b60dee7b7871"],
    },
    {
        "slug": "brutalist-grid",
        "title": "Brutalist Night Grid",
        "thesis": "a compact square industrial watch built from blunt structural planes and a disciplined exposed grid, rugged in role but contemporary in control scale",
        "architecture": "Use a near-square black glass display recessed inside four separate dark titanium perimeter beams. Join the beams at squared corner keys with narrow honest seams; show exactly four flush graphite retaining points aligned to the load path. Beneath them place an inset black polymer shock carrier and a narrower lower case. Protect one compact burnt-orange right-side rocker between upper and lower beam extensions. The control remains inside the case envelope.",
        "strap": "Use a complete dense charcoal elastomer strap with broad rectangular load pads near the case, fine stippled valleys, smooth bevelled edges, open-ended underside channels, precise round holes, two low keepers and a complete dark titanium pin buckle. Use short visible fork-and-pin joints with aligned axes.",
        "interface": "Show large bone-white time ‘23:47’, one burnt-orange square status block, and a sparse three-line grid labelled ‘SECTOR 3’ without fake measurements.",
        "cmf": "coarse bead-blasted dark titanium impression, low-sheen black polymer, deep black glass, charcoal elastomer and one restrained burnt-orange functional accent",
        "camera": "a low front-right three-quarter view on raw pale concrete, hard broad overhead light, controlled side fill and a narrow orange-reflecting rim",
        "avoid": "military camouflage, G-Shock imitation, giant buttons, decorative screw field, unprotected glass, malformed beam joints, excessive thickness or fake certification",
        "evidence": ["watch-atom:watch-silhouette-distance-read@sha256:22744f2a0b53d51c020355c3550b7382c6aaadd159a82e862891ca9fb5b57e95", "watch-atom:watch-protection-without-bulk@sha256:514869453eb42fb652a311ed1825f0ded1671aa3a148fafae66c00d5005e29b5", "watch-atom:watch-control-protrusion-hierarchy@sha256:a8607f61300cb7dc0d111471cf5b92d8b8039d76f4ca2aa2ad9200f472eb0b9a", "watch-atom:watch-service-seam-honesty@sha256:70c41e07e7c48f3d4b1b8a439fe09fb22c4f94f21d6068b6386e605f4c16bd58"],
    },
    {
        "slug": "biomorphic-pebble",
        "title": "Biomorphic Pebble",
        "thesis": "a friendly organic digital watch with a softly pinched pebble case and a continuous flexible cradle, expressive through touchable form rather than jewellery or sports cues",
        "architecture": "Shape the case as an irregular rounded pebble with a subtle waist on the left and a fuller lower-right lobe. Seat an off-centre rounded black display under a frosted translucent mint upper shell. Reveal a lavender inner carrier only through two controlled side windows, above a smooth opaque mint lower case. Use no metal bezel. Integrate one shallow thumb dimple into the right shell as the only control boundary.",
        "strap": "Create a complete translucent-mint elastomer cradle strap that rises under the lower case and separates into two flexible wings, then becomes a conventional softly tapered strap. Add scattered shallow oval dimples only on the outer wings, a smooth centre, rolled edges, elongated adjustment slots, one lavender keeper and a complete matte lavender pin buckle. Keep every cradle junction clean and removable-looking.",
        "interface": "Use a soft cream background with large dark-violet time ‘10:16’, one coral breathing blob and a tiny word ‘CALM’; no health metrics or diagnosis.",
        "cmf": "frosted translucent mint polymer impression, opaque mint lower shell, lavender inner carrier and buckle, soft mint elastomer, cream display and one coral accent",
        "camera": "a near-front elevated view with slight right yaw on a pastel lilac background, very soft shadowless key, subtle subsurface-looking edge light and a small grounded contact shadow",
        "avoid": "perfect symmetry, circular or square case, capsule fitness tracker, medical styling, hard metal lugs, floating cradle, toy gloss or missing closure",
        "evidence": ["watch-atom:watch-silhouette-distance-read@sha256:22744f2a0b53d51c020355c3550b7382c6aaadd159a82e862891ca9fb5b57e95", "watch-atom:watch-lugless-articulation@sha256:575930f155d47e60d23e20d87df2ce1afc67412c86130eaf26575c110661c0a8", "watch-atom:watch-strap-case-continuity@sha256:062fec296783eb15792c09457b589a5d37dc99def6e54a2026223db41362002a", "watch-atom:watch-color-identity-restraint@sha256:bd94bc063c27cee202e59e54dbdbc55d4449c11c28446dfc6c29b936ce679b6c"],
    },
    {
        "slug": "amber-wedge",
        "title": "Neo-1970s Amber Wedge",
        "thesis": "a sharply tailored retro-future digital watch with a smoked amber glass wedge, warm architectural colour blocking and precise integrated strap geometry",
        "architecture": "Use a horizontal trapezoidal case that is wider at the top and tapers toward the wrist, with a smoked amber glass canopy sloping down toward the viewer. Clamp the canopy between two brushed bronze side cheeks and a dark oxblood lower tray. Show narrow linear seams and crisp planar transitions. Integrate one thin black horizontal rocker into the right bronze cheek and one tiny recessed circular port below it, clearly secondary.",
        "strap": "Use a complete oxblood elastomer strap integrated into broad concealed hinges under the bronze cheeks. Give it three rows of elongated rounded perforations, fine parallel micro-grooves between rows, cream-coloured sealed edge piping, a matching oxblood keeper and a complete brushed bronze rectangular pin buckle. Keep the geometry tailored, not sporty.",
        "interface": "Show large segmented pale-cream numerals ‘18:42’, one narrow amber progress bar and the single word ‘EVENING’ on a dark brown display.",
        "cmf": "smoked amber glass, brushed bronze metal, matte oxblood lower shell and strap, cream edge piping and black control hardware",
        "camera": "a dramatic low front-left view on a deep chocolate background with a focused warm key, thin cream bounce and long graphic shadow",
        "avoid": "round smartwatch, analogue hands, chrome nostalgia cliché, bulky case, random vents, modern blue neon, malformed canopy seams, incomplete perforated strap or missing buckle",
        "evidence": ["watch-atom:watch-silhouette-distance-read@sha256:22744f2a0b53d51c020355c3550b7382c6aaadd159a82e862891ca9fb5b57e95", "watch-atom:watch-case-display-ratio@sha256:0b25056bd64309ec27b04ac906d4a85d56d64a68b661652c41510d936d98c4d8", "watch-atom:watch-finish-hierarchy@sha256:c0a92334357b1172ce653dab17198363165462d401eff39ae190b60dee7b7871", "watch-atom:watch-strap-material-context@sha256:d5ae9a2374638a414336bd4cde8311915b863236481bda26ab2f61960ff96965"],
    },
    {
        "slug": "skeletal-hex",
        "title": "Skeletal Hex Performance",
        "thesis": "a high-technology hexagonal digital watch whose identity comes from a real outer load frame, suspended inner display carrier and selectively exposed assembly",
        "architecture": "Build a compact six-sided outer frame from matte off-white ceramic-like corner beams joined to a black carbon-like inner carrier at six visible dark metal pivot nodes. Suspend a rounded-hex black glass display inside the carrier with a consistent recessed gap. Keep the lower case narrow and dark. Integrate one small acid-lime rectangular key into the right black carrier, protected by two off-white beam ends. Every node must align and no beam may float.",
        "strap": "Use a complete black technical elastomer strap connected through two wide split yokes integrated into the inner carrier, not the ceramic beams. Add shallow tessellated hex microtexture only in two outer fields, a smooth central load path, acid-lime underside ventilation slits, one black keeper and a complete black folding pin buckle with one lime release index.",
        "interface": "Show a black screen with large white time ‘06:35’, one acid-lime angular cadence trace and one small label ‘READY’; no fake performance values.",
        "cmf": "matte off-white ceramic-like outer beams, black carbon-like carrier, dark metal nodes, black glass and strap, acid-lime functional accent below three percent",
        "camera": "a dynamic elevated front-right view on a cool silver-grey surface, crisp directional key, strong dark fill control and thin acid-lime reflected edge light",
        "avoid": "decorative floating skeleton, six oversized screws, tactical camouflage, giant key, broken beam intersections, fake carbon weave everywhere, excessive lime, incomplete yokes or closure",
        "evidence": ["watch-atom:watch-silhouette-distance-read@sha256:22744f2a0b53d51c020355c3550b7382c6aaadd159a82e862891ca9fb5b57e95", "watch-atom:watch-protection-without-bulk@sha256:514869453eb42fb652a311ed1825f0ded1671aa3a148fafae66c00d5005e29b5", "watch-atom:watch-service-seam-honesty@sha256:70c41e07e7c48f3d4b1b8a439fe09fb22c4f94f21d6068b6386e605f4c16bd58", "watch-atom:watch-no-ornament-without-role@sha256:549e6a538c35a0d9431ec4a190d051d50c89c754a5e62f4973f287804bccf67d"],
    },
    {
        "slug": "architectural-ribbon",
        "title": "Architectural Ribbon",
        "thesis": "a tall ultra-thin digital watch designed as a silver architectural frame threaded by one cobalt structural ribbon, balancing strict geometry with vivid graphic colour",
        "architecture": "Use a narrow vertical rectangular display with square-ish corners inside two separate brushed-silver side columns. Connect the columns only through slim top and bottom crossbars, creating a precise open frame around a floating-looking but physically seated black glass module. Run one cobalt-blue metal spine behind the display and visibly continue it into the upper and lower strap connectors. Use one tiny red square side key flush with the right column. Keep the lower case as a thin black inset tray.",
        "strap": "Use a complete cobalt-blue composite elastomer strap aligned exactly with the rear spine. The outer surface has a fine woven microtexture interrupted by one smooth central ribbon, the edges are sealed in black, and the underside carries sparse horizontal grip bars. Use rectangular adjustment holes, one yellow keeper and a complete minimalist brushed-silver pin buckle with a red tongue tip.",
        "interface": "Use an off-white screen with large black time ‘12:04’, one cobalt vertical rule, one small red square and one small yellow circle in an asymmetrical grid; no decorative text.",
        "cmf": "brushed silver metal, cobalt-blue satin spine and strap, black glass tray and sealed edges, off-white interface, one red control and one yellow closure accent",
        "camera": "a precise near-orthographic front view tilted slightly down and right on a pure light-grey background, broad even architectural light and one crisp short shadow",
        "avoid": "rounded generic smartwatch, miniature phone, floating glass without supports, thick columns, extra buttons, colour gradients, decorative screws, misaligned spine, incomplete strap or missing closure",
        "evidence": ["watch-atom:watch-silhouette-distance-read@sha256:22744f2a0b53d51c020355c3550b7382c6aaadd159a82e862891ca9fb5b57e95", "watch-atom:watch-strap-case-continuity@sha256:062fec296783eb15792c09457b589a5d37dc99def6e54a2026223db41362002a", "watch-atom:watch-material-zoning-purpose@sha256:f6ad7222ffc44c364212f706cb9e5c5dc9e0960057fefabf91447da3b7ae496d", "watch-atom:watch-color-identity-restraint@sha256:bd94bc063c27cee202e59e54dbdbc55d4449c11c28446dfc6c29b936ce679b6c"],
    },
]

records=[]
for i,c in enumerate(concepts,1):
    prompt=f"""Create exactly ONE premium industrial-design hero image containing exactly ONE complete DIGITAL smartwatch.

VISUAL THESIS
{c['title']}: {c['thesis']}. This is a free design study and must not resemble the other concepts in silhouette, CMF, interface or photographic mood.

COMPOSITION AND CAMERA
Show one complete connected watch with the entire case, glass, controls, lower-case transition, both attachment joints, both strap segments, adjustment system, keeper and complete closure inside frame. Arrange the strap as one natural open loop. Use {c['camera']}. Maintain one coherent perspective and reveal every identity-bearing connection. No wearer, hand, second product, inset, exploded view, contact sheet, label, logo or watermark.

CASE ARCHITECTURE
{c['architecture']} Use clean material boundaries, uniform intentional seams, a visible upper/middle/lower hierarchy and a coherent load path. Keep glass seated rather than floating.

STRAP AND CLOSURE
{c['strap']}

CMF
Use {c['cmf']}. Give every material a distinct finish and scale of texture. Keep accents controlled and every transition tied to a real part.

INTERFACE
{c['interface']} Preserve edge clearance and one primary read. No analogue hands, physical hour markers, app grid, dense pseudo-data or unsupported capability claim.

DETAIL HIERARCHY
First read is the unique silhouette; second is the case-to-strap construction; inspection details are surface turns, seam continuity, control seating, pivot alignment, strap edge finish and closure construction. Keep quiet surfaces between them.

HIGH-COST FAILURES
Avoid {c['avoid']}; also avoid broken perspective, duplicated or missing controls, impossible attachments, incomplete product, extra products, panels, brands, logos, watermark or engineering/medical claims.
"""
    pf=f"{i:02d}-{c['slug']}.txt"; of=f"{i:02d}-{c['slug']}.png"
    (out/pf).write_text(prompt,encoding='utf-8')
    records.append({"index":i,"title":c['title'],"prompt":pf,"output":of,"sourceEvidence":["watch-base-model:concept-image@1.0.6","watch-knowledge-catalog@0.2.0",*c['evidence']]})
(out/'generation-plan.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('wrote',len(records),'prompts')
