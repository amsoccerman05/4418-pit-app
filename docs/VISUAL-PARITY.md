# Inventory / Pit visual parity

Reference: neighboring Inventory repository at commit `5d0ed2dee3e0c39bb935421aa0665a0d9b1dbd3e`, `src/style.css`, `src/main.tsx`, `src/services/auth.tsx`, and `public/branding/`. Values include the stylesheet's final readability overrides, not just its earlier declarations. Inventory was read only.

Shared values are reproduced in `src/tokens.css` and consumed by Pit's existing stylesheet.

| Component          | Inventory values now used in Pit                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branding           | Identical official transparent rocket emblem and IMPULSE wordmark files; unrotated dark-green logo container; 4418 wordmark with module subtitle                                                  |
| Typography         | DM Sans body, Manrope headings/metrics, same Google Fonts weights; 14px body/working text, 31px/750 desktop H1, 28px phone H1; readable final Inventory heading scale                             |
| Palette            | Text `#253c34`, headings `#243c32`, muted `#637368`, background `#f6f8f6`, white surfaces, brand `#224d3e`                                                                                        |
| Buttons            | Primary `#28583f`, hover `#193f2c`, secondary border `#dde5db`, hover `#f1f5ee`; 6px radius, 11px × 15px padding, 14px labels, Inventory button shadow                                            |
| Shell              | 238px desktop sidebar, 210px intermediate sidebar, 77px header, 1570px content limit, 40px desktop gutter; Workspace → current page breadcrumb, role pill, official avatar                        |
| Navigation         | Active `#eaf0e7` / `#2a5740`, inactive `#738077`, hover `#f0f3ef`, 6px radius; Inventory count treatment                                                                                          |
| Cards/metrics      | 9px panel radius, `#e1e7dd` panel border, `#e1e7df` metric border and subtle Inventory stat shadow; 20px panel padding and shared gaps                                                            |
| Inputs/forms       | `#dee5d9` border, `#3c5135` input text, `#53684f` labels, 5px radius, 17px field spacing; Inventory focus rings `#77a58b` / `#7aa68b`                                                             |
| Lists/history      | `#edf0e8` separators, `#fcfdfb` row hover, 14px issue text, aligned padding and muted secondary text; no new table or changed record structure                                                    |
| Badges             | 4px radius, 4px × 7px padding, 12px type, 1.4 line-height; Pit severity/state colors retained                                                                                                     |
| Dialogs            | 680px desktop maximum, 13px radius, 26px desktop/20px phone padding, Inventory `#172c2266` backdrop and `0 20px 90px #10251c40` shadow; native dialog/focus behavior retained                     |
| Empty states/login | Inventory neutral background, white 9px panels, 430px login card, 32px desktop/24px phone login padding, 50px empty-state spacing and shared heading/body styles; removed separate login gradient |
| Feedback           | Inventory neutral local-demo strip, error palette, white bordered toast/shadow                                                                                                                    |

## Deliberate Pit adaptations

- Existing one-tap bottom navigation remains on phones instead of Inventory's drawer. It uses the same navigation colors/type/borders. No extra navigation steps were introduced.
- Minimum 44px tap targets, 16px phone form controls, readable status labels, and large readiness/battery numbers remain for competition use.
- READY, NEEDS ATTENTION, ROBOT DOWN, battery-state and issue-severity/status foreground/background colors are unchanged.
- Existing data, actions, auth, RLS, realtime, models, and workflows are untouched. No Inventory, deployment, DNS, or Supabase settings changed in this pass.

## Verification

- TypeScript and production build passed (existing Vite bundle-size advisory remains).
- All 11 database/model tests and 18 existing desktop/phone browser tests passed.
- Additional visual review covers Issues empty/populated, report form, issue detail, battery removal, and no-event/no-battery empty states at desktop/phone widths. Screenshots are under ignored `test-results/`.
- Existing responsive checks cover 390/768/1280/1440px Dashboard and Batteries. Official asset copies are byte-identical to Inventory.
