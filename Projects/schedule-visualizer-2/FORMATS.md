# Schedule Visualizer 2: formats

Every format the tool reads or writes is described here, with its version.
So far that is one: the project object.

## The project object

Format name `sv2-project`, version **1**.

A project is one school: its building, its schedule and its settings. It is
one plain JSON object. It is what the planner keeps on the device, and the
project file is this object written out.

The code that defines it is `engine/schema.js`. `engine/validate.js` checks
every rule on this page and `engine/repair.js` enforces them on every load.

### Rules that hold everywhere

- **Ids.** Every id is a string of 10 characters from `a-z` and `0-9`. The
  first is a letter that says what the thing is: `p` project, `f` floor, `r`
  room, `o` other space, `k` corridor name, `x` exit, `c` connection, `z`
  zone, `s` subject, `t` teacher, `g` group, `d` day type, `i` image, `n`
  snapshot. An id is unique across the whole project, never changes and is
  never reused. Renaming something never changes its id.
- **Names are data.** Any name a user can type may hold any character and is
  stored exactly as typed, surrounding spaces included. Nothing here trims,
  escapes or rejects a character.
- **Dates** are ISO 8601 in UTC, for example `2026-10-08T14:02:11.000Z`.
- **Bell times** are 24-hour `HH:MM`, for example `08:05`.
- **Colours** are `#rrggbb`.
- **A cell** is a whole number: its index into the floor, row by row from the
  top left. Cell `y * width + x` is column `x` of row `y`.
- **Periods** are numbered from 0 in the data. Period 0 is shown as
  "Period 1".
- **Unknown fields are kept.** A field this page does not list is left where
  it is on load.

### Top level

| Field | Type | Meaning |
|---|---|---|
| `format` | `"sv2-project"` | Fixed. |
| `version` | integer | `1`. A missing version reads as 0 and is migrated. A larger one is refused whole with: "This file was made by a newer Schedule Visualizer 2. Open it at greyversusblue.com, or ask for a file saved in format 1." |
| `id` | id, `p…` | The project's identity. It survives export and import. |
| `created` | date | When the project was made. |
| `modified` | date | Set by the store on every change, undo and redo included. |
| `settings` | Settings | Below. |
| `building` | Building | Below. |
| `subjects` | Subject[] | In the school's own order. |
| `teachers` | Teacher[] | |
| `groups` | Group[] | |
| `dayTypes` | DayType[] | At least one. `dayTypes[0]` is the base day type ("A Day"). |
| `accepted` | AcceptedFinding[] | Findings the user has accepted. |
| `scenario` | Scenario or `null` | The one open scenario. |
| `publish` | PublishSettings | |
| `onboarding` | Onboarding | Getting started. |

### Settings

| Field | Type | Default | Range and meaning |
|---|---|---|---|
| `schoolName` | text | `""` | Empty shows the tool's own name. |
| `periods` | integer | `8` | 1 to 16. Every day and every bell schedule has this many entries. |
| `periodWord` | text | `"Period"` | `"Period"`, `"Mod"`, `"Block"` or `"Hour"`. Names are Period 1, Mod 1, Block A, 1st Hour. |
| `defaultPassingSeconds` | integer | `240` | 0 to 3600. Used where bell times are missing. |
| `defaultHeadCount` | integer | `25` | 1 to 999. Used for a group with no head count. |
| `secondsPerCell` | integer | `3` | 1 to 10. Walking time for one corridor cell. |
| `secondsPerStair` | integer | `8` | 2 to 30. Per level changed on a stair connection. |
| `colourScale.mode` | text | `"relative"` | `"relative"` or `"absolute"`. |
| `colourScale.bands` | integer[4] | `[10, 25, 50, 100]` | The loads at which bands 2 to 5 begin in absolute mode. Each larger than the one before, 1 to 99999. |
| `checks.consecutiveLimit` | integer | `4` | 1 to 16. A teacher teaching more periods in a row than this is a warning. |
| `checks.passingMarginSeconds` | integer | `0` | 0 to 600. Added to the passing time before a walk counts as late. |
| `checks.off` | text[] | `[]` | The check kinds switched off, each once. |
| `timeFormat` | text | `"12h"` | `"12h"` or `"24h"`. Display only; times are stored as 24-hour. |
| `paper.size` | text | `"letter"` | `"letter"` or `"a4"`. A new project takes the device's region. |
| `paper.orientation` | text | `"portrait"` | `"portrait"` or `"landscape"`. |
| `theme` | text | `"auto"` | `"auto"`, `"light"` or `"dark"`. |

### Building

| Field | Type | Meaning |
|---|---|---|
| `floors` | Floor[] | At least one, in display order. |
| `connections` | Connection[] | Stairs. |
| `zones` | Zone[] | Areas left out of the congestion colour scale. |

**Floor**

| Field | Type | Meaning |
|---|---|---|
| `id` | id, `f…` | |
| `name` | text | Default "Floor 1", "Floor 2". |
| `level` | integer | Which storey this is. A stair connection costs by the difference in level, never by display order, so reordering floors changes no route. A new floor gets its position plus one; a file without the field gets the same on load. |
| `width`, `height` | integer | 5 to 200 each. |
| `cells` | text | `width * height` characters, row by row: `.` empty, `#` corridor, `S` stairs. |
| `spaces` | Space[] | Rooms and other spaces. Their cells are `.` in `cells`. |
| `corridors` | CorridorName[] | Named runs of corridor cells. |
| `exits` | Exit[] | |
| `image` | TraceImage or `null` | The traced floor plan, if any. |

A cell is empty, corridor, stairs, or owned by exactly one space. A space's
cell is never `#` or `S`, and no cell belongs to two spaces. On load, a cell
claimed twice goes to the space that is earlier in `spaces`, and a corridor or
stairs cell under a space is cleared.

**Room** (a space with `kind: "room"`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id, `r…` | | |
| `kind` | `"room"` | | |
| `cells` | integer[] | | At least one, each once. |
| `number` | text | `""` | Free text. Empty means not numbered yet. Numbers that are not empty are unique across the building, compared without regard to capitals or surrounding spaces. |
| `teacherIds` | id[] | `[]` | Teachers based here. The first is the main teacher. Each once. |
| `subjectId` | id or `null` | `null` | `null` is "no subject". |
| `wing` | text | `""` | |
| `capacity` | integer or `null` | `null` | 1 to 999. |
| `shared` | boolean | `false` | True for a gym, cafeteria or library: several groups at once is not a double-booking. |
| `doors` | Door[] | `[]` | With none, the room is entered from any side that touches a corridor. |

**Door**: `{ cell, side }`. `cell` is one of the room's own cells. `side` is
`"n"`, `"e"`, `"s"` or `"w"`. The cell across that side is a corridor or
stairs cell. Each door once.

**Other space** (a space with `kind: "other"`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id, `o…` | | |
| `kind` | `"other"` | | |
| `cells` | integer[] | | At least one, each once. |
| `label` | text | `""` | |
| `otherKind` | text | `"other"` | `"bathroom"`, `"office"`, `"storage"`, `"library"`, `"outdoor"`, `"utility"` or `"other"`. |
| `colour` | colour | `"#9aa3ad"` | |

**CorridorName**: `{ id, name, cells }`. `id` is `k…`. `cells` are corridor
cells (`#`), at least one, and a cell has at most one name on its floor.

**Exit**: `{ id, cell, doorName, assembly }`. `id` is `x…`. `cell` is a
corridor cell with at least one side that is empty or off the grid. One exit
per cell. `doorName` ("Door B") and `assembly` ("Front lawn by the flagpole")
are text and may be empty.

**Connection**

| Field | Type | Meaning |
|---|---|---|
| `id` | id, `c…` | |
| `label` | text | Not empty. Given at creation from the first unused letter (A to Z, then AA, AB) and never renumbered. |
| `a`, `b` | `{ floorId, cell }` | The two ends. Each is a stairs cell (`S`) on a floor of this building, and they are not the same cell. The two ends may be on one floor. A stairs cell may carry more than one connection. |
| `direction` | text | `"both"`. `"ab"` and `"ba"` are reserved for one-way stairs. |

**Zone**: `{ id, floorId, label, x, y, w, h }`. `id` is `z…`. A rectangle of
whole cells inside its floor, `w` and `h` at least 1.

**TraceImage**

| Field | Type | Default | Meaning |
|---|---|---|---|
| `imageId` | id, `i…` | | The stored image this refers to. The bytes are kept apart from the project on the device. |
| `opacity` | number | `0.4` | 0 to 1. |
| `scale` | number | `1` | Above 0. |
| `rotation` | number | `0` | Degrees. |
| `x`, `y` | number | `0` | Position, in cells. |
| `visible` | boolean | `true` | |
| `locked` | boolean | `false` | |
| `width`, `height` | integer | | Pixels of the stored image, at least 1. |
| `missing` | boolean | `false` | Set on load when the image is not on this device. The position is kept. |

### Subject

`{ id, code, name, colour }`. `id` is `s…`. `code` and `name` are text.

### Teacher

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id, `t…` | | |
| `name` | text | | Not blank. Unique without regard to capitals or surrounding spaces. |
| `subjectId` | id or `null` | `null` | |
| `roomIds` | id[] | `[]` | The rooms the teacher is based in, each once. |
| `notes` | text | `""` | |

A teacher's `roomIds` and a room's `teacherIds` say the same thing: a room is
in a teacher's list exactly when the teacher is in the room's list. The
room's list holds the order (main teacher first). On load, a link named on
only one side is added to the other, so nothing is lost.

### DayType

| Field | Type | Meaning |
|---|---|---|
| `id` | id, `d…` | |
| `name` | text | "A Day", "B Day", or the school's own. |
| `own` | boolean | `dayTypes[0]` is always `true`. `false` means "the same as the first day type" for bells and for every group's day. |
| `bells` | (Bell or `null`)[] | One entry per period. `null` means not entered. For a day type that is not `own`, every entry is `null`. |

**Bell**: `{ start, end }`, both bell times. An end before its start is
allowed in the data; the bell checks warn about it and never block.

A day type that is not `own` has no data of its own. Everything that asks
about it is answered from `dayTypes[0]`, through `engine/day-types.js`. On
load, a day type marked not `own` that does carry bell times or group days
becomes `own`, so nothing that was entered disappears.

### Group

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id, `g…` | | |
| `name` | text | | Not blank. Unique without regard to capitals or surrounding spaces. |
| `grade` | text | `""` | Free text. |
| `headCount` | integer or `null` | `null` | 1 to 999. `null` uses `settings.defaultHeadCount`. |
| `colour` | colour | next unused preset | |
| `days` | `{ [dayTypeId]: Slot[] }` | | One key for each day type that is `own`, and no other key. Each list has `settings.periods` slots. |

**Slot**

| Field | Type | Default | Meaning |
|---|---|---|---|
| `room` | id or `null` | `null` | A room in the building. |
| `roomText` | text | `""` | Kept when the room is not in the building: a deleted room's number, or a number that was imported and never drawn. |
| `label` | text | `""` | An optional subject or course label. |
| `teacherIds` | id[] | `[]` | Teachers named for this slot, each once. Empty means "the room's teachers". |

A slot with `room: null` and `roomText: ""` has no room entered. A slot with
`room: null` and text in `roomText` is in a room that is not in the building,
and is shown that way until the user changes it. Deleting a room rewrites the
slots that named it to `{ room: null, roomText: <its number> }`.

### AcceptedFinding

`{ findingId, reason, at }`. `findingId` is the finding's id, built from its
kind and the ids it is about. `reason` is text. `at` is a date.

### Scenario

| Field | Type | Meaning |
|---|---|---|
| `name` | text | |
| `changes` | Change[] | |
| `compared` | `null` or `{ fileName, addedGroups, removedGroups }` | Set when the scenario came from comparing with another project file. The two lists hold group names. |

**Change** is one of:

| `kind` | Other fields | Meaning |
|---|---|---|
| `"move"` | `dayTypeId`, `groupId`, `period`, `roomId` | One group, one period, another room. |
| `"swapPeriods"` | `dayTypeId`, `groupId`, `periodA`, `periodB` | Swap two of a group's periods. |
| `"swapRooms"` | `dayTypeId`, `groupA`, `groupB`, `period` | Swap two groups' rooms for a period. |

Every change names its own day type. A change is checked for shape only. A
change that points at a group, room, day type or period that is gone is not
removed on load: the scenario lab reconciles it and says what it dropped.

### PublishSettings

| Field | Type | Default | Meaning |
|---|---|---|---|
| `passcode` | text | `"bulldogs2015"` | The staff passcode. Empty means protection is off. |
| `stalenessDays` | integer | `60` | 1 to 3650. |
| `views` | `{ [view]: boolean }` | all `true` | One key for each of `teacher`, `group`, `room`, `map`, `free`, `now`, `common`, `coverage`, `sub`, `directions`, `staffing`. |
| `teacherNamesOnMap` | boolean | `true` | |
| `lastPublishedAt` | date or `null` | `null` | |

### Onboarding

`{ steps, dismissed, neverShow }`. `steps` is an object whose values are all
`true`, one key per step done. The other two are booleans, default `false`.

### Version history

| Version | What changed |
|---|---|
| 0 | Data with no `version`. A scenario held one `dayTypeId` for all of its changes. |
| 1 | `format` and `version` are in the object. Each scenario change has its own `dayTypeId`. `Floor.level` exists. |

### What is never in a project

Routes, loads, crowd results, findings, teacher days and every count on
screen are worked out from the project and never stored in it.
