# What has actually worked in desktop metaphors — and what it means here

Research note, 2026-07-28. Basis for `2026-07-28-desktop-metaphor-shell-design.md`.

## 1. The taskbar was a usability finding, not a decoration

Microsoft's Windows 95 team began with a modest idea: change minimized windows from icons to
"tiles". Testing killed it. The finding underneath was that **windows did not appear constantly,
so users could not see which windows were open** or get back to them. The taskbar exists because a
persistent, always-visible inventory of what exists is what made the system legible. The team also
abandoned design-then-test in favour of iterate-against-users, because their first ideas failed.

- Sullivan, K. (1996), *The Windows 95 User Interface: A Case Study in Usability Engineering*,
  CHI '96. <https://dl.acm.org/doi/fullHtml/10.1145/238386.238611>
- Summary: <https://www.osnews.com/story/144509/the-windows-95-user-interface-a-case-study-in-usability-engineering/>

**Bearing on FormFactors.** This is our exact defect. One program window that can be closed to
nothing, plus up to six artifact windows floating with no registry, no z-order and no minimize.
Nothing on screen answers "what exists right now". Any bottom bar we build — taskbar, shelf or
timeline — is a *view over that missing inventory*, so the inventory is the real work.

## 2. Xerox Star: coherence beat cleverness

The 1981 Star put "the top of an office desk, together with surrounding furniture and equipment"
on screen. Its designers attributed the result not to icons but to **a small set of design
principles applied rigorously across two dozen functional areas**, so that experience in one area
transferred to the others. The metaphor's job was to reduce the "alien feel" of the machine.

- Smith, Irby, Kimball, Verplank, Harslem (1982), *Designing the Star User Interface*.
  <https://dl.acm.org/doi/10.1145/1500774.1500840>
- Overview: <https://link.springer.com/chapter/10.1007/978-1-4757-3510-9_21>

**Bearing.** Argues against four bespoke desktops and for **one set of slots filled four ways**.
Consistency is the mechanism of legibility; four hand-built shells would each have to re-earn it.

## 3. Apple's HIG: see-and-point, and the noun-verb order

The 1987 guidelines rest on two paradigms: users can **see** what they are working with at all
times, and can **point** at what they see. Objects stay visible while acted on, and the effect of
an action is immediately visible. Selection precedes command — noun, then verb.

- <http://www.medien.ifi.lmu.de/fileadmin/mimuc/mmi_ws0304/reading/2003-11-20_apple.pdf>

**Bearing.** This is already the project's own grammar — point at a thing, then speak the verb. The
shell should make the *noun* more visible, never less. Any skin that hides what the agent can touch
is working against the thesis, which is the standing objection to shell D.

## 4. The strongest counter-argument, and it describes this project

Gentner & Nielsen's *The Anti-Mac Interface* (1996) argued the desktop metaphor should be
superseded. Their case: metaphors map incompletely onto the target domain, import irrelevant
constraints from the source domain, and diverge in behaviour — and the training benefit decays as
users stop having office filing as prior knowledge. Their proposed replacements were **language as
the interface**, **a richer representation of objects** (attributes, relationships, provenance),
and **shared control**, where "both humans and computer agents take initiative".

- <https://www.nngroup.com/articles/anti-mac-interface/>
- ACM: <https://dl.acm.org/doi/pdf/10.1145/232014.232032>

**Bearing.** FormFactors *is* their proposal, thirty years on. So the metaphor here cannot be
justified on 1984 grounds — it is not teaching anyone what a computer is. Its new job is to make
**the agent's reach legible**: what it can touch, what it made, where it acted. That reframing is
what turns wallpaper and taskbar from set-dressing into evidence, and it is why the shell is worth
building as a *measured* variable rather than a coat of paint.

## 5. Why the metaphor persists anyway: spatial memory

Stable positions let people build cognitive maps and retrieve by recognition rather than recall.
The desktop survives flat design because the structural metaphor — windows, stable furniture,
persistent locations — carries the load, not the wood grain.

**Bearing.** Two concrete rules. Taskbar items must be ordered by **open time, not focus order**,
or they reshuffle under the user's hand and destroy the recognition benefit. And a skin switch must
not silently move a window the user placed.

## 6. Fidelity has a measurable cost

Higher-fidelity prototypes make participants behave more naturally, but can **inflate perceived
usability** and distort time-based measures. Participants also partially correct for fidelity when
judging ease.

- <https://www.nngroup.com/articles/ux-prototype-hi-lo-fidelity/>
- <https://measuringu.com/prototype-fidelity/>

**Bearing.** Argues against cloning Windows or macOS. A credible generic desktop gets the
behavioural transfer without inviting "why doesn't this work like Windows?" on every missing
affordance — which is precisely the imported-constraint failure from §4. It also means shell must
be recorded on the session arm: if the metaphor inflates self-reported usability, we need to be
able to see that in the data rather than be fooled by it.

## 7. Browser desktops confirm the low floor

daedalOS, Puter and Windows96 are consistently described as needing no tutorial: taskbar, draggable
windows, icons and a launcher, and people simply proceed. The reported value is the absence of a
learning curve.

- <https://github.com/DustinBrett/daedalOS> · <https://www.xda-developers.com/puter-browser-based-operating-system/>

**Bearing.** The familiar shell is cheap to make legible — conventions do the work. It is the right
baseline against which to measure the three agent-native shells.

## Summary of what the research changes about the plan

1. Build the **window inventory first**; every skin is a projection of it (§1).
2. **One slot system, four compositions** — not four desktops (§2).
3. Order taskbar entries by **open time**; never reshuffle on focus (§5).
4. **Generic-credible, not a clone** of any real OS (§4, §6).
5. Record `shell` on the session arm, because fidelity can bias the very judgements we collect (§6).
6. The metaphor's job here is **legibility of the agent's reach**, not training — so a skin that
   hides the programs the agent acts on is working against the thesis (§3, §4).
