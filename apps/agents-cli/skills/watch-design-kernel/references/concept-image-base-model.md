# Concept Image BaseModel 1.0.0

This is the mandatory visual planning model for the first product-focused image of one future smartwatch. It is adapted from the `watch-openai` Concept Image BaseModel experiment for native Jarvis Prompt authoring.

The final Prompt is the complete visible design specification. Resolve every applicable variable before generation. Describe visible results, not rationale, provenance, hidden engineering, manufacturability, performance, or medical validity.

## Frame invariant

Create exactly one continuous premium industrial-design product frame containing one complete watch.

Required:

- one watch, one coherent pose, one camera;
- complete case, display, visible controls/openings, attachment, strap, and closure readable as one object;
- enough product occupancy for inspection without cropping identity-bearing parts;
- a clean product-reference result suitable for later visual continuity.

Forbidden by default:

- people, hands, wrists, multiple watches, spare straps;
- panels, dividers, insets, contact sheets, parallel variants or multiple scenes;
- exploded views, diagrams, specification sheets, or detail crops replacing the complete product;
- logos, brand names, watermarks, paragraphs, fake specifications, engineering/medical claims, or released-product implications.

## Mandatory visible design sections

Write the final Prompt in the following order. A concise but explicit paragraph or labelled block is acceptable; omission is not.

### 1. Visual thesis and evidence priority

Resolve:

- concept title and one-sentence visual thesis;
- hero statement: what the image should prove at first glance;
- first, second, and third visual reads;
- 3–6 primary visible variables and supporting variables;
- forbidden visual outcomes specific to the concept.

Evidence priority changes salience, never whether a core component exists.

### 2. Single-product composition

Resolve:

- product pose and complete strap pose;
- camera position, elevation, azimuth, and perspective character;
- framing and product occupancy;
- visible sides and which identity-bearing surfaces must remain visible;
- occlusion constraints, especially crown/buttons, attachment, lower case transition, and closure.

### 3. Case architecture and proportions

Resolve:

- primary silhouette;
- case layer stack: glass/display boundary, upper case or bezel, main frame, lower case/back transition;
- sidewall geometry and underside geometry;
- edge/facet family, seams, and transitions;
- case width and height character;
- visual thickness target and how layering produces it;
- display-to-case ratio and corner-radius relationship;
- case-to-strap width ratio;
- control scale, attachment span, first strap drop, underside taper, and visual mass distribution.

Do not claim exact dimensions unless explicitly supplied by the user.

### 4. Display and glass

Resolve:

- display shape and active-area relationship;
- glass geometry and edge treatment;
- bezel expression and visible layer stack;
- reflection behaviour that reveals glass without obscuring the interface.

### 5. Controls and openings

For every expected control or opening, explicitly state either its visible design or that it is intentionally not applicable. Resolve:

- type, position, geometry, scale/protrusion;
- material, finish, colour, and boundary expression;
- relationship to the case;
- hierarchy and spacing rhythm between crown, buttons, speaker/microphone openings, or other visible elements.

Never omit a difficult component merely to simplify the render.

### 6. Attachment and complete strap

Resolve:

- attachment type and visible geometry;
- first-segment articulation/drop and relationship to the case;
- overall strap construction;
- each visible strap layer: location, material, colour, pattern, edge, and thickness;
- hole/adjustment system;
- closure type, geometry, finish, and relationship to the strap;
- how the entire strap remains readable in the single frame.

### 7. Surface and CMF zones

Resolve at least these physical zones when visible:

- glass/display boundary;
- upper case or bezel;
- main case frame;
- lower case/back transition;
- controls/openings;
- attachment;
- strap outer and inner surfaces;
- closure.

For each zone specify material impression, colour, finish, texture scale, reflectivity, boundary with neighbours, and light response. Then define:

- reflectivity hierarchy;
- colour area budget and accent restraint;
- texture-scale hierarchy;
- continuity rules across seams and transitions.

### 8. One visible interface state

Resolve:

- one screen state and background treatment;
- 3–7 visible interface layers with geometry, position, relative scale, colour/luminance, and priority;
- spacing rhythm, edge clearance, and information density;
- at least one intentional visual echo between digital interface and hardware;
- readable-content policy.

Avoid logos, long copy, fake metrics, tiny pseudo-data, app-grid clutter, generic glowing rings, and visual claims unsupported by the brief.

### 9. Detail hierarchy

Resolve:

- first-read identity features;
- product-distance features;
- inspection-distance details;
- 2–6 signature details;
- quiet zones;
- repetition rule across geometry, openings, textures, or interface;
- contrast budget so richness does not become random decoration.

### 10. Lighting and environment

Resolve:

- key, fill, and rim light;
- how lighting reveals glass, metal/polymer, texture, controls, and edge transitions;
- backdrop and supporting surface;
- environmental reflections;
- contact shadow, depth, and separation from the background.

Lighting must prove material and architecture rather than hide unresolved geometry.

### 11. Forbidden visual outcomes

End the Prompt with explicit negatives covering at least:

- identity drift and generic smartwatch clichés;
- incorrect silhouette, excess thickness, or broken case/strap continuity;
- duplicated/missing controls, impossible attachment, incomplete strap, or absent closure;
- plastic-looking premium materials, uncontrolled highlights, random accent colours;
- unreadable or over-dense interface;
- extra products, panels, crops, labels, logos, watermark, and unsupported claims.

## Knowledge integration

Selected Knowledge Atoms contribute visible moves to the sections above:

- use `move.action` as a design operation;
- use `move.visible_cues` as image-checkable evidence;
- respect `avoid_when`, `move.limits`, and incompatible trade-offs;
- do not paste claims, rationale, evidence citations, or validation needs into the provider Prompt;
- record atom identity only in the Tool's internal `sourceEvidence` field.

## Final completeness check

Before generation, answer internally:

1. Can the complete watch be reconstructed from this Prompt without inventing a core component?
2. Does every selected atom produce at least one visible cue?
3. Are silhouette, proportions, controls, attachment, CMF, interface, and lighting mutually coherent?
4. Is the image still one clean product frame rather than a presentation board?
5. Are all BaseModel and atom versions recorded in `sourceEvidence`?

If any answer is no, revise before calling the image Tool.