# Program platform + the diverse program set — a substrate that declares its reach

## Context

The user's ask: *"add a more diverse set of programs"*, *"think about this from a step-by-step
learning POV"*, and *"video apps, vscode and more, to show the full extent of a substrate that
adjusts to your needs, abilities, etc."* Chosen set: the existing four plus **Notes, Files,
Calendar, Mail, Settings**, then **Code** and **Video** as the ability-spectrum ends.

The blocker is not authoring surfaces — it is that adding one `ProgramId` today touches **~26
seams, and the five most dangerous fail silently** (full map in the 2026-07-28 exploration,
summarised in §1). Hand-threading seven new programs through those seams would multiply every
silent hole by seven. So this phase is two things in one cycle: **PR — make programs declarative
data over type-enforced seams**, then **PS — the program set as registry entries**.

Companion spec: `2026-07-28-desktop-metaphor-shell-design.md` (lands first — the window inventory
is what makes a taskbar meaningful before there are nine programs to list). Learning ladder R0–R5
is defined there, §0b.

**Rulings taken during design (2026-07-28):**

1. Program set = all four proposed **plus Settings** (user's choice), plus Code and Video from the
   follow-up. Browser and media-timeline-as-editor rejected (fake web is a rabbit hole; a media
   library teaches scrubbing, not honesty).
2. **Depth is a declared tier, not an implied promise.** Not every program is equally operable;
   every program is equally honest about what the agent can do there. "Adjusts to your abilities"
   is implemented as declared capability, never as discovered failure.
3. Programs declare the learning rung they teach best; missions select surfaces by rung instead of
   hardcoding program ids.
4. Seed data stays Meridian-coherent — the cross-referenced corpus is the liberty-audit surface.

---

## §1 The five silent seams (why the platform comes first)

From the exploration, with today's behaviour on a missing entry:

| seam | today's failure |
|---|---|
| `getProgram` → `?? PROGRAMS[0]` (scenarios.ts:160) | an unlisted id **silently becomes Microsoft Word** — title, prompt, entities, all of it |
| `applyAction` / `serializeMockDoc` / `gist` switch on `doc.kind`, non-exhaustive | fall off the end → **`undefined` with no compile error** (no `strictNullChecks`); the model reads literal `"undefined"` |
| `PROGRAM_IDS` `satisfies` (scenarios.ts:30) | checks membership, not completeness → combine **silently excludes** the program as a source |
| `ProgramSurface` dispatcher (ProgramSurface.tsx:219-227) | unknown kind → **empty div**, zero entity bboxes, pointing dies quietly |
| `classOf` fallback `?? 'command'` (scenarios.ts:532) | an unmapped verb **commits without witness** under default autonomy — the single most dangerous default in the verb layer |

Every one of these becomes a compile error or an honest runtime error in PR. None may survive as a
fallback.

---

## §2 PR — the `ProgramDef` registry

**`src/programs/types.ts`** (new)

```ts
import type { MockDoc, ProgramId, Task } from '../scenarios';
import type { SubEntityDeriver } from '../entities/subEntities';

export type ProgramTier =
  | 'deep'       // full verb set incl. authorial content — the ask surface reaches here
  | 'operable'   // real verbs, narrower: the agent operates it, some asks never arise
  | 'pointable'; // the agent sees, points, describes — and SAYS it cannot operate yet

export type LearningRung = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

export interface ProgramDef {
  id: ProgramId;
  label: string;
  icon: string;                    // lucide icon name, consumed by taskbar/source-rail parts
  docKind: MockDoc['kind'];
  tier: ProgramTier;
  rung: LearningRung;              // what this surface teaches BEST (missions select by this)
  cannot?: string;                 // tier<deep: one honest sentence of what the agent can't do here,
                                   //   rendered into the program's prompt line — stated, not discovered
  seedDoc(): MockDoc;              // Meridian-coherent seed
  elements: ProgramElement[];      // the 4-element chrome/primary/lookalike/content convention
  tasks: Task[];                   // drives buildActionTools AND the suggestion chips
  subEntities?: SubEntityDeriver;  // pointable sub-items (cells, list items, events, clips)
  teachScript: TeachCopy;          // the Record<ProgramId, …> in demoScript.ts moves here
}
```

**`src/programs/registry.ts`** (new) — `PROGRAM_DEFS: Record<ProgramId, ProgramDef>`. A `Record`
over the full union: **adding a `ProgramId` without a def is a compile error**, which closes seams
1, 3 and 4 at the type level. Derived exports replace today's hand-maintained lists:
`PROGRAM_IDS = Object.keys(PROGRAM_DEFS)`, `PROGRAMS` (the legacy shape, derived during migration),
`getProgram(id)` with the `?? PROGRAMS[0]` fallback **deleted** — an unknown id returns an
errors-as-data result naming the known ids, same discipline as `validateRefineCall`.

**Exhaustiveness** — `src/programs/exhaustive.ts`: `assertNever(x: never): never`. Every
`switch (doc.kind)` in `applyAction`, `serializeMockDoc`, `gist`, `initialMockDoc`, and the
`ProgramSurface` dispatcher gains a `default: return assertNever(doc)` — a new `MockDoc` member
that misses a branch becomes a **compile error**, closing seam 2 even without `strictNullChecks`.

**`VERB_CLASS`** becomes `Record<KnownVerb, VerbClass>` where
`KnownVerb = keyof typeof ACTION_VERBS | 'combine' | 'refine_artifact' | …` (the full literal
union), and `classOf` **loses its `?? 'command'` fallback**: an unmapped verb is a compile error at
the table and an honest `{error}` at runtime, never a silent unwitnessed commit. Closes seam 5.

**Consumers switch to the registry** (each currently hand-synced): Dock/taskbar icons,
`seedCorpus()` (derived — the `Record<ProgramId, MockDoc>` completeness it already enforces now
comes from defs), `tasksForProgram`, `buildActionTools`, `SUB_ENTITY_DERIVERS`, teaching `COPY`,
`demoRail`. The **authorial pair moves in lockstep by construction**: `ASK_CONTENT_TOOL`'s
program gate (App.tsx:417) and `authorialField` (validate.ts) both derive from a single
`authorialFields?: {field, question}[]` entry on the def — the exploration flagged this pair as
hand-synced two ways, and this is the fix.

**Capability honesty** — the mechanism behind ruling 2: the prompt already derives what the agent
can do from `buildActionTools` (verbs derive from tasks), so a narrow def is automatically a
narrow, truthful prompt. The `cannot` sentence is additive: tier `operable`/`pointable` programs
state their boundary in their own prompt line ("I can trim clips with your confirmation, but I
can't colour-grade") so the boundary is **stated up front, never discovered by a failing call**.
The gate's `{error}` path stays as the backstop, not the announcement.

**Migration invariant:** the existing four programs move onto `ProgramDef` with **zero behaviour
change** — same verbs, same tasks, same entities, same seeds, byte-identical prompts (pinned by
the existing prompt regression tests). PR ends with 4 registry programs and every seam closed; PS
adds the other seven as data.

---

## §3 PS — the program set

| Program | tier | rung | what it uniquely adds | key entities / verbs |
|---|---|---|---|---|
| **Notes** | deep | R1 | simplest surface; first contact — pointing at list items | list items as sub-entities; `edit_content` (item text IS authorial → gate + ask), check/uncheck |
| **Files** | deep | R2 | the metaphor's own organ; the most legible undo there is | file rows as sub-entities; rename (authorial name → ask), move, both witnessed under manual |
| **Calendar** | deep | R3 | time + genuine ambiguity — "move this to Tuesday": *which* Tuesday? conflicts | events as sub-entities; move/retitle; ambiguity routes through the ask surface with candidate chips (the two Tuesdays ARE the candidates) |
| **Mail** | deep | R3 | outward stakes; `share`/`act_on` finally have a real home | threads/messages as sub-entities; reply body IS authorial; **send is verb-class `share` → always witnessed under auto-safe**, honestly SIMULATED like `act_on` |
| **Settings** | operable | R5 | **operates the actual substrate** — toggles are real dials | each toggle maps to a `DialValues` field / register / shell-skin; "turn on speech feedback" → witnessed `dials.set`; the teaching system's natural target ("how do I…?" has a true answer) |
| **Code** | operable | R2 | the expert end; Terminal-register affinity | file tree + editor panes as entities; witnessed edits to one seeded script; `cannot`: "I can't run or debug code here" |
| **Video** | pointable | R2 | a genuinely new entity granularity: clips on a timeline | timeline/clips/playhead as sub-entities; `cannot`: "I can see your timeline and describe clips, but I can't cut or grade yet" — the substrate's honesty about its own edge, on display |

Notes on the load-bearing rows:

- **Mail is where the honesty thesis pays.** Send routes through verb-class `share`, which
  `decideCommit` already always-witnesses under auto-safe — no new policy, the existing gate
  finally has stakes worthy of it. The send is simulated and *says so*, exactly like `act_on`.
- **Settings closes the loop on R5.** It is the one program whose document is the substrate
  itself: its "doc" renders from live `DialValues`/register/skin state, and edits dispatch real
  `dials.set`. Witnessed, because a settings change alters agent behaviour. (Deferred from the
  shell spec by explicit ruling — it is a program, not chrome.)
- **Video ships tier `pointable` deliberately.** One program whose declared boundary is visible in
  a sitting demonstrates "adjusts to abilities" better than seven fully-built ones. Promotion to
  `operable` (witnessed trim) is a later, cheap step *because* of PR.
- **Calendar's ambiguity is the ask surface's first natural workload** — the gate was built on
  authorial *absence*; Calendar exercises authorial *ambiguity* ("which Tuesday?") with the
  candidate chips carrying the two concrete dates.

**Seed corpus (Meridian-coherent):** Mail holds a thread from Riverside Tower's contractor and one
about Dockside Depot's delay; Calendar holds the two project reviews and a conflicting slot; Notes
holds the punch-list the Word doc summarises; Files lists the artifacts the desk has produced plus
the seeded documents; Code holds the small site-report script that generates the Excel figures;
Video holds three clips of the Dockside walkthrough. Cross-references are the audit surface: the
agent claiming Mail says something it doesn't is catchable against pixels.

**MockDoc union** grows additively (`notes`, `files`, `calendar`, `mail`, `settings`, `code`,
`video` members). Per the seam map the journal corpus is `Partial<Record<ProgramId, MockDoc>>` and
restore falls back to `seedCorpus()`, so **additive members need no `JOURNAL_VERSION` bump** —
verified at review time against the shell phase's bump to 2 (this phase must not double-bump).

---

## §4 Verification

- **The registry completeness test is the phase's keystone**: for every def in `PROGRAM_DEFS` —
  seed a doc, serialize it (`serializeMockDoc`, `gist`) and assert the string contains no
  `"undefined"`, apply every verb the def's tasks expose against the seed (no `undefined` return,
  identity-or-changed only), derive sub-entities without id collisions (registry namespace rule),
  and mount its surface in the keyless drive with ≥1 measured bbox per element. This test is what
  kills the silent-`undefined` class permanently.
- **The four hardcoded enumeration tests** found in exploration (`demoRail.test.ts:22`,
  `seeds.test.ts:8-13`, `subEntities.test.ts`, `instructions.test.ts`) switch to iterating the
  registry, so a tenth program is covered on arrival.
- Migration gate: prompt snapshots for the existing four are **byte-identical** before/after PR.
- Pure TDD per program: authorial-field decisions (Mail body → ask; Files rename → ask), Calendar
  ambiguity → `needsContent` with date candidates, Settings toggle → `dials.set` witnessed, Code
  and Video `cannot` lines present in their prompt sections.
- Full suite each task; `tsc --noEmit` + `vite build`; keyless browser drive across all nine on
  both a familiar and one agent-native shell; live smoke rows: Mail send witnessed + simulated
  disclosure spoken, Calendar "move the review to Tuesday" → ask with two dated chips, Settings by
  voice flips a real dial, Video boundary stated unprompted.

## §5 Out of scope, named

- Multiple concurrent program windows (single `activeProgram`, measurement collision) — still the
  most likely phase after this one.
- A browser program; real filesystem or network; running code in Code; actual video decode (Video
  renders poster frames + a timeline model).
- Promotion of Video to `operable` (designed-for, not built).

## After approval

Spec review → `superpowers:writing-plans` for the PR/PS implementation plan (PR tasks first; PS
programs as data-only tasks after the platform lands). Shell phase (SH) executes before this one.
