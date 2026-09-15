# JarvisHub commercial-use and rebranding license review

> Practical engineering review, not legal advice. Have counsel review the final distribution, branding, third-party assets, and provider terms before launch.

## Conclusion

The upstream repository `LYL1015/JarvisHub` identifies its license as **Apache License 2.0**. The checked-in root `LICENSE` grants a perpetual, worldwide, royalty-free copyright license to reproduce, prepare derivative works, publicly display and perform, sublicense, and distribute the work and derivatives. It also grants a patent license subject to the license's patent-litigation termination clause.

Subject to compliance, this permits:

- commercial use and a paid hosted service;
- modification of the underlying code;
- private/proprietary modifications;
- replacement of JarvisHub-facing UI, names, logos, and organization copy with the operator's own branding;
- distribution of modified source or object forms under additional/different terms for the operator's modifications or derivative as a whole, while preserving Apache-2.0 compliance for the upstream work.

No Apache-2.0 clause requires the JarvisHub name to remain visible in the product UI. Section 6 does **not** grant trademark rights beyond reasonable descriptive origin/NOTICE use, so rebranding is also the safer product-brand posture. Rebranding does not permit removing required copyright/license attribution or representing the upstream code as wholly original.

## Obligations that matter

When distributing the work or a derivative in source or object form, Apache-2.0 section 4 requires:

1. give recipients a copy of the Apache-2.0 license;
2. make modified files carry prominent notices stating that they were changed;
3. retain applicable copyright, patent, trademark, and attribution notices from the source form;
4. reproduce applicable NOTICE attribution if the upstream work includes a NOTICE file.

The inspected JarvisHub root has no root `NOTICE` file, but it does contain third-party notices inside vendored material, including `vendor/ppt-master/skills/ppt-master/scripts/pptx_shapes/data/NOTICE.md`; those notices and accompanying licenses must remain with the relevant material.

A hosted server that is not delivered to customers is generally different from distributing the server source. However, a web application sends compiled JavaScript and other object-form assets to browsers, so the conservative implementation is to ship a legal/third-party-notices surface and include the Apache-2.0 text with the distributed web artifacts regardless of the exact SaaS analysis.

Apache-2.0 does not grant rights to user-provided logos, generated outputs, model/provider services, datasets, fonts, images, or independently licensed dependencies. Those require separate compliance.

## Repository-specific observations

- Root license: `LICENSE`, Apache License 2.0, with `Copyright 2025 Beq`.
- Upstream README also states that JarvisHub is licensed under Apache License 2.0.
- GitHub's repository metadata reports SPDX `Apache-2.0` for `LYL1015/JarvisHub`.
- No root NOTICE file was found.
- A production dependency inventory from `pnpm licenses list --prod --json` reported permissive license families only in the current installation: MIT, Apache-2.0, ISC, BSD, 0BSD, and dual permissive alternatives. This is an engineering snapshot, not a complete legal audit and should be regenerated for the exact release artifact.
- Vendored PPT material includes its own Apache and MIT license/NOTICE files. Generated presentations may also incorporate user assets or externally sourced images under separate terms.

## Recommended commercial-release checklist

- Keep the upstream `LICENSE` in source and release distributions.
- Add `THIRD_PARTY_NOTICES.md` and include the JarvisHub attribution plus all applicable vendored/dependency notices.
- Add a legal/about surface accessible from the shipped web client.
- Record major modified source files with an appropriate changed-file notice or adopt a consistent repository-wide modification-notice policy reviewed by counsel.
- Use the organization's own product name, logo, domains, UI copy, screenshots, and demo assets.
- Do not imply endorsement, partnership, or official continuity with JarvisHub/Beq/LYL1015.
- Keep proprietary modules' copyright notices separate from upstream notices.
- Audit exact production dependencies, fonts, icons, templates, sample brand assets, generated media, and model/provider terms before each release.
- Replace the current shared disposable R2 asset storage before handling customer or commercial-confidential material.
- Obtain legal review before customer launch, especially for SaaS/browser-distribution treatment and modified-file notice implementation.

## Primary sources

- Local/upstream license: `LICENSE`; <https://github.com/LYL1015/JarvisHub/blob/main/LICENSE>
- Official Apache License 2.0 text: <https://www.apache.org/licenses/LICENSE-2.0>
- Upstream repository metadata: <https://api.github.com/repos/LYL1015/JarvisHub>
- Upstream README licensing statement: <https://github.com/LYL1015/JarvisHub#license>
- Vendored shape-data notice: `vendor/ppt-master/skills/ppt-master/scripts/pptx_shapes/data/NOTICE.md`
