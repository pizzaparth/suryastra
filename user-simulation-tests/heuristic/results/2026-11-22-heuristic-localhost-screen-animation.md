# Heuristic review: Suryastra animation page (localhost:5179)

Date: 2026-11-22. Scope: one screen, four captured states (S1 paused start, S2 chapter 1→2 boundary, S3 chapter 2, S4 chapter 3 close-up). Driver: Claude in Chrome.
Raters: localhost-power, localhost-average, localhost-low-literacy (3/3).
Priority = business impact × mean usability rating. Convergence = raters who marked the finding important to them.
Method note: to keep this short, the orchestrator wrote this report instead of the report-synthesizer and summary agents. All numbers are computed exactly as the skill specifies.

| # | Finding | Heuristic | Business | Usability (P/A/L) | Avg | Priority | Convergence |
|---|---|---|---|---|---|---|---|
| E6 | India close-up does not label the 6 alerted receiver sites | 6 Recognition | 2 | 2/3/3 | 2.7 | 5.4 | 2/3 |
| E3 | Alerts called "Red"/"Orange" are drawn in monochrome (badges and globe markers) | 2 Real world | 2 | 1/3/3 | 2.3 | 4.6 | 2/3 |
| E2 | Unexplained jargon (Dst, nT, Bz, Rₑ, "From observed Dst") | 2 Real world | 2 | 1/2/3 | 2.0 | 4.0 | 1/3 |
| E4 | Alert block changes nouns, heading and order between chapters 2 and 3 | 4 Consistency | 2 | 1/2/2 | 1.7 | 3.4 | 2/3 |
| E7 | Chapter overlay and scrim hide the camera zoom; title shown three times | 8 Minimalist | 2 | 2/2/1 | 1.7 | 3.4 | 1/3 |
| E8 | Particles, field lines and large satellites clutter the India close-up | 8 Minimalist | 2 | 1/2/2 | 1.7 | 3.4 | 1/3 |
| E9 | No legend for the 3D encodings (particle colours, field lines, marker shapes) | 10 Help | 2 | 1/2/2 | 1.7 | 3.4 | 0/3 |
| E1 | Speed buttons do not show the active speed | 1 Visibility | 2 | 2/1/1 | 1.3 | 2.6 | 1/3 |
| E5 | Timeline event markers are unlabeled ticks (tooltips blocked by pointer-events: none) | 6 Recognition | 2 | 2/1/1 | 1.3 | 2.6 | 1/3 |

Coverage: 1 violations, 2 violations, 3 clean, 4 violations, 5 clean, 6 violations, 7 clean, 8 violations, 9 not observable (no error state), 10 violations.

Orchestrator verification: E1 did not reproduce in the live page. The active speed button has `aria-pressed="true"` and a filled white background. The snapshot does not expose pressed state, so the expert could not see it.

## Animation defects found in code (outside the heuristic lens)

- Camera blends shots by moving its position in a straight line. The wide → Earth zoom can cut close to or through the magnetosphere.
- In chapters 2 and 3 the camera follows India as Earth turns: about 5°/s at 1× and about 106°/s at 20×, so the view spins.
- Dragging or zooming the view snaps back at every chapter change.
