# Schedule Visualizer 2: formats

Every format the tool reads or writes is described here, with its version:

| Format | Name in the file | Version | Section |
|---|---|---|---|
| The project object | `sv2-project` | 1 | The project object |
| The project file | `sv2-project` | 1 | The project file |
| A recovery point, exported | `sv2-project` | 1 | The recovery export |
| The building file | `sv2-building` | 1 | The building file |
| The schedule file | `sv2-schedule` | 1 | The schedule file |
| The groups CSV and its template | none (CSV) | | The groups CSV |
| The other CSV exports | none (CSV) | | The CSV exports |

Every JSON file says its `format` and `version` first. A file whose version
is larger than the tool knows is refused whole, with: "This file was made by a
newer Schedule Visualizer 2. Open it at greyversusblue.com, or ask for a file
saved in format 1." A file is checked in full before anything in the project
changes, and a file that fails changes nothing.

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

## The project file

Format name `sv2-project`, version **1**. Written and read by
`engine/project-file.js` (`writeProjectFile`, `readProjectFile`).

The project file is the project object above as JSON, in UTF-8, indented by
two spaces, with one line ending after the closing brace. It differs from the
object on the device in one way: traced images.

**Traced images.** The device keeps a traced image's bytes apart from the
project. In the file each floor's `image` carries two more fields:

| Field | Type | Meaning |
|---|---|---|
| `data` | text | The image's bytes as base64. They are the bytes the device holds, never encoded again, so export, import, export gives the same file. |
| `type` | text | The image type, for example `image/png`. |

A floor whose image is not on the exporting device has neither field, and its
`missing` is `true`. On import the two fields are taken out of the project and
handed to the device's image store; an image that arrived without bytes is
marked `missing` and keeps its position.

**Reading.** In this order, and the first that fails is the refusal:

1. The text is JSON. Otherwise: "This file could not be read. It is not a
   Schedule Visualizer 2 file, or it was cut short when it was saved or sent.
   Export it again and choose the new file."
2. It is an object whose `format` is `sv2-project`, or has no `format` and has
   a `building`, `groups` or `dayTypes` (a file from before files carried a
   version). A building, schedule or published file is refused by name:
   "This is a building file, not a project file. It holds a building and no
   schedule: import it as a building." Anything else: "This is not a Schedule
   Visualizer 2 project. Choose a project file the tool exported."
3. Its `version` is a whole number, 0 or more (missing reads as 0). A version
   above 1 is refused with the newer-version sentence at the top of this page.
4. Image bytes are base64 text with an image type.
5. A version 1 file passes every rule on this page as it stands. Nothing is
   repaired on the way in: a file that breaks a rule is refused with "This
   project file cannot be imported, and nothing was changed. N things in it
   are not as the format says. The first: `path`: what is wrong."
6. An older file is migrated one version at a time, then filled in as on
   every load (a missing field takes its default), and then has to pass every
   rule.

The reader returns the project, the images, the notes of anything it filled
in, the version the file was in, and a count of what it holds. Putting it in
place of the current project is one undo entry (`actions.replaceProject`).

Round trip: writing a project, reading the file and writing again gives the
same file, byte for byte. `test/fixtures/formats/project-v1.json` is a file
written at version 1, kept to prove that later versions of the tool still
read it and write it back unchanged.

## The recovery export

Format name `sv2-project`, version **1**. Written by `storage/session.js`
(`exportRecoveryPoint`) through `writeProjectFile`; read by `readProjectFile`.

A recovery point exported from the Project section **is a project file**. It
has no format of its own: the same fields, the same traced images as `data`
and `type`, the same reader and the same refusals. It is named
`<school> - recovery point - <the day the point was taken>.json`, so it can be
told from an ordinary export on disk; nothing inside the file says it came
from a recovery point.

What is written is the point's project brought up to date first (migrated and
repaired as it would be on load), so a point taken by an older version of the
tool exports as a current file. The time the point was taken, the reason and
its size stay on the device and are not in the file.

On the device a recovery point is a record in the IndexedDB database
`sv2-recovery`, store `recovery`: `{ takenAt, reason, summary, bytes, project,
images }`, with `reason` one of `timer`, `leave`, `replace`, `import`,
`restore`, `summary` as `{ floors, rooms, groups, teachers }`, and `images` as
`{ [imageId]: Blob }`. That record is the device's own and is not a file
format; no other tool should read it.

## The building file

Format name `sv2-building`, version **1**. `writeBuildingFile`,
`readBuildingFile`, `applyBuilding` in `engine/project-file.js`; the import is
`actions.importBuilding`, one undo entry.

```
{
  "format": "sv2-building",
  "version": 1,
  "building": Building,
  "subjects": Subject[]
}
```

| Field | Meaning |
|---|---|
| `building` | The Building of the project object, whole: floors, connections, zones. Traced images carry `data` and `type` as in the project file. |
| `subjects` | The subjects the building's rooms use, as in the project object, in the school's order. May be left out. |

A room in the file keeps its `teacherIds` and `subjectId` as they were in the
project it came from.

**Reading.** JSON; `format` is `sv2-building` (another of the tool's files is
refused by name); `version` is 1 (larger is refused as newer); then the
building has to pass every Building rule of the project object, and each
subject every Subject rule. A room's `teacherIds` is a list of ids, each once.

**Importing** replaces the project's building. The rules:

- The file's ids are kept. An id in the file that this project already uses
  for something that is not part of its building is a refusal.
- A room keeps the teachers it lists who are teachers of this project, by id.
  The others are left off. Every teacher's `roomIds` is worked out again from
  the rooms.
- A room's subject is matched to this project's subjects by id, then by code
  and name together (without regard to capitals or surrounding spaces). A
  subject the project does not have is added at the end of the list, with the
  file's id when that id is free. A room whose subject is not in the file's
  `subjects` and not in the project has no subject.
- A schedule slot stays with its room when the new building has a room with
  the same id. Otherwise it goes to the room with the same number. Otherwise
  it becomes `{ room: null, roomText: <the old room's number> }` and reads
  "not in the building".
- A slot that already holds only a number (`room: null`, text in `roomText`)
  is given the room with that number, if the new building has one.
- Accepted findings and the scenario are left as they are.

## The schedule file

Format name `sv2-schedule`, version **1**. `writeScheduleFile`,
`readScheduleFile`, `applySchedule` in `engine/project-file.js`; the import is
`actions.importSchedule`, one undo entry.

```
{
  "format": "sv2-schedule",
  "version": 1,
  "settings": { "periods", "periodWord", "defaultPassingSeconds", "defaultHeadCount" },
  "rooms": [{ "id", "number" }],
  "subjects": Subject[],
  "teachers": Teacher[],
  "groups": Group[],
  "dayTypes": DayType[]
}
```

| Field | Meaning |
|---|---|
| `settings` | Those four settings of the project object, all present. |
| `rooms` | The room index: one entry for each room a slot or a teacher names, with the number it had when the file was written. It is how the file is read against a building whose rooms have other ids. |
| `subjects`, `teachers`, `groups`, `dayTypes` | As in the project object, unchanged. A slot's `room` and a teacher's `roomIds` are ids found in `rooms`. |

**Reading.** JSON; `format` is `sv2-schedule`; `version` is 1; every field
above is present; then the settings, subjects, teachers, groups and day types
have to pass every rule of the project object, with `rooms` standing for the
building: a slot or a teacher naming a room that is not in the index is a
refusal, and so are two index entries with one number.

**Importing** brings the schedule into the project. The rules:

- **Subjects, teachers and day types** are matched to this project's by id,
  then by name (a subject by code and name together), without regard to
  capitals or surrounding spaces. One that matches is left exactly as it is
  here. One that does not is added, with the file's id when that id is free.
- **Rooms** are matched by id, then by the number in the index. A slot whose
  room is not in this building becomes `{ room: null, roomText: <the number> }`.
  A new teacher's room that is not in this building is left off the teacher.
- **Groups** are matched by name. A group that is not here is added, with the
  file's id when that id is free. A clash is answered once for all or group
  by group: **skip** (the default), **overwrite** (the group here keeps its
  id and its name as typed here, and takes the file's grade, head count,
  colour and days) or **rename** (imported as a new group under " (2)",
  " (3)", or a name the user gives).
- **The school day.** A file with more periods than the project makes the
  project's day that long; nothing is cut. A file with fewer leaves the later
  periods as they are.
- **Bells.** A bell time already entered here is never changed. One that is
  empty here is filled from the file.
- **Day types.** A day type that has its own bells or rooms in the file and
  is the same as the first day type here becomes its own copy here. A new
  day type that is its own copy gives every group already here a copy of its
  first day.
- **Settings.** The period word and the two defaults are taken from the file
  only when the user asks (`takeSettings`).

Importing a project's own schedule file changes nothing and makes no undo
entry.

## The groups CSV

Read by `engine/import-groups.js`, written by `engine/exports.js`
(`groupsRows`, `templateRows`). CSV as `engine/csv.js` reads and writes it:
quoted fields, line breaks inside quotes, a byte-order mark, any line ending.

**What the tool writes.** UTF-8 with a byte-order mark, CRLF line endings.
The first row is the header:

```
Group,Grade,Head count,Colour,A Day Period 1,…,A Day Period 8,B Day Period 1,…,B Day Period 8
```

The period columns are every period of every day type, in order, each named
with the day type's name and the period's name in the school's word. With one
day type the day type's name is left out ("Period 1"). The **template** is
this header and no other row. The **groups export** adds one row per group:
name, grade, head count (empty for none), colour as `#rrggbb`, then the room
number of each period. A slot whose room is not in the building has its text.
A day type that is the same as the first has empty cells.

A cell holds the room's number and nothing else. The label and the teachers
named for a slot are not in the CSV; the schedule file carries them.

**What the tool reads.** The first row is the header. The tool guesses what
each column is and the user can change every guess before importing:

| Role | Headers guessed |
|---|---|
| name | Group, Group name, Groups, Name, Section, Class |
| grade | Grade, Grade level, Year, Year group |
| head count | Head count, Headcount, Students, Number of students, Size, Enrollment, Enrolment |
| colour | Colour, Color |
| day type | Day type, Daytype, Day |
| period | The period's name in the school's word ("Period 3", "Mod 3", "Block C", "3rd Hour"), or Period / Per / Pd / P / Mod / Hour / Hr / Block / Blk with a number, or a number alone. A letter alone only in a school that letters its periods. A day type's name before or after it ("A Day Period 1", "Period 1 (B Day)") puts the column in that day type. |
| ignore | Anything else. A column the tool does not understand is never taken for a period. A period past the end of the school day is ignored and says so. |

Headers are compared without regard to capitals or spaces at the ends.

More than one day type can be given three ways:

- **Wide.** The period columns once per day type, as the tool writes them. A
  second run of the same period headers with no day type named is the second
  day type.
- **A day column.** One row per group per day type, with the day type's name
  in the day column. An empty day cell is the first day type.
- **Blocks.** A row holding nothing but a day type's name starts that day
  type's rows. A repeat of the header row is passed over.

Rules for the rows:

- A row with no group name is skipped, and the preview says so. So is a row
  naming a day type the project does not have, and a second row giving the
  same group the same day type.
- A group's name and grade are kept exactly as typed.
- A head count is a whole number from 1 to 999; a colour is `#rrggbb`,
  `rrggbb` or `#rgb`. One that cannot be read is left out with a warning, and
  the row is still imported.
- A room number is matched to the building without regard to capitals or
  surrounding spaces. A number that is not in the building is kept as typed
  in `roomText`, and the preview lists it with the rows that name it.
- An empty cell in a period column is an empty period.
- Rooms for a day type that is the same as the first make it its own copy
  (every group already here gets a copy of its first day). Empty cells for
  such a day type leave it as it is.

Name clashes with groups already in the project are answered as for the
schedule file: skip (the default), overwrite, or rename. On overwrite a slot
whose room does not change is left alone; one whose room changes keeps its
label and loses the teachers that were named for the old room. Periods and
day types the file has no column for are untouched.

The import is `actions.importGroups`, one undo entry.

## The CSV exports

All written by `engine/exports.js`: UTF-8 with a byte-order mark, CRLF, the
header first. Every name is written exactly as typed. With the `guard` option
on, a cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a
single quote in front so a spreadsheet does not run it; the option is off by
default because it changes such a name, and a guarded file does not read back
to the same names.

| Export | Columns | Rows |
|---|---|---|
| Groups | as "The groups CSV" | one per group |
| Groups template | the same header | none |
| Teachers | Teacher, Subject code, Subject, Rooms, Notes | one per teacher. Rooms are room numbers joined by "; ". |
| Rooms | Room, Floor, Teachers, Subject code, Subject, Wing, Capacity, Shared space, Doors | one per room, floor by floor. Teachers are names joined by "; ", main teacher first. Shared space is Yes or No. Doors is a count. |
| Teachers by period | Teacher, Day type, then one column per period | one per teacher per day type. A cell is "group · room number" for each group taught, joined by "; ", or "Planning". |
| Rooms by period | Room, Floor, Day type, then one column per period | one per room per day type. A cell is the groups in the room, joined by "; ". Room numbers that slots name and the building does not have come last, with "not in the building" as the floor. |

The two grids come from the same rules as every screen: a teacher's day from
`engine/teacher-day.js`, and a day type that is the same as the first reads
the same as the first.

**File names.** Every export is named `<school> - <what> - <date>.<ext>`,
for example `Marrowby Middle School (sample) - groups - 2026-09-01.csv`. The
school is the school name with the characters a file system refuses left out
(`< > : " / \ | ? *` and control characters), or "Schedule Visualizer 2" when
the project has no school name. The date is the day of the export on the
user's device.

## The published data

Format name `sv2-published`, version **1**. Made by `publishedModel(project,
{ clock })` in `engine/publish-data.js`. It is what the staff browser reads: a
subset of the project in the project's own shape, so the engine's functions
run on it unchanged, and `validate` and `repair` accept it.

| Field | Type | Meaning |
|---|---|---|
| `format` | text | `"sv2-published"` |
| `version` | integer | `1` |
| `id` | id | The project's id. The staff browser keeps a reader's settings under it. |
| `publishedAt` | date | When it was published, in UTC. Shown in the reader's own time zone. |
| `staleAfter` | date | `publishedAt` plus the project's `publish.stalenessDays`. After it the staff browser shows a notice and goes on working. |
| `settings` | object | `schoolName`, `periods`, `periodWord`, `defaultPassingSeconds`, `secondsPerCell`, `secondsPerStair`, `timeFormat`, as in the project. |
| `building` | object | `floors` and `connections`. A floor has `id`, `name`, `level`, `width`, `height`, `cells`, `spaces`, `corridors`, `exits`. A room and an other space have every field they have in the project. |
| `subjects` | list | As in the project. |
| `teachers` | list | As in the project: `id`, `name`, `subjectId`, `roomIds`, `notes`. |
| `dayTypes` | list | As in the project. |
| `groups` | list | `id`, `name`, `grade`, `colour`, `days`. |
| `publish` | object | `views` (one true or false for each view) and `teacherNamesOnMap`. |

Never in it: a group's `headCount`, `settings.defaultHeadCount`, a floor's
`image`, `building.zones`, `scenario`, `accepted`, `onboarding`,
`publish.passcode`, `publish.stalenessDays`, `publish.lastPublishedAt`,
`created`, `modified`, the settings only the planner uses (`colourScale`,
`checks`, `paper`, `theme`), and anything worked out (routes, loads, travel
times, findings). The model is built by naming each field that goes in, so a
field the project gains later is not published until it is named.

Nothing that is named is dropped: a double-booked room, a teacher with two
rooms and a slot whose room is not in the building are published as they are.
A view switched off in `publish.views` is hidden by the staff browser; the
teachers, groups and rooms are all still in the data.

## The locked published data

Format name `sv2-published-locked`, version **1**. Made by `lockPublished` and
opened by `unlockPublished` and `unlockWithKey` in `engine/publish-crypto.js`.
When the project has a passcode, this is published in place of the data above.

| Field | Type | Meaning |
|---|---|---|
| `format` | text | `"sv2-published-locked"` |
| `version` | integer | `1` |
| `schoolId` | id | The project's id. |
| `publishedAt` | date | As above. It is the one thing about the schedule that can be read without the passcode. |
| `kdf` | object | `{ name: "PBKDF2", hash: "SHA-256", iterations: 310000, salt }`. `salt` is 16 bytes as base64. |
| `cipher` | object | `{ name: "AES-GCM", iv }`. `iv` is 12 bytes as base64. |
| `data` | text | The published data above as JSON in UTF-8, encrypted, with the 16-byte tag at the end, as base64. |

The key is 32 bytes from PBKDF2 over the passcode as UTF-8. The additional
data of the encryption is the text `sv2-published-locked`, `1`, `schoolId` and
`publishedAt` on four lines, so a file whose date or school was edited does
not open. The salt is the first 16 bytes of SHA-256 over
`sv2-published-salt:` and the school's id, the same for every publish of a
school; the IV is new for every publish. A reader's device keeps the key, not
the passcode, so the passcode is asked once per device, and a kept key opens
every later file published with the same passcode.

## The published file

One HTML file, made by `assemble(read, data)` in `ui/staff/assemble.js` from
`staff/index.html`. It asks for nothing when opened. Inside it:

- the stylesheet `staff/staff.css` in a `<style>` element, each font it names
  as a `data:font/woff2;base64,` address;
- the data in `<script type="application/json" id="sv2-published">`: either
  format above, as JSON with every `<` written `<` and the characters
  U+2028 and U+2029 written as escapes;
- one `<script type="module">` holding the modules listed in
  `staff/manifest.js`, joined by the linker rule at the top of
  `ui/staff/assemble.js`.

The file is named `<school> - staff schedule - <date>.html`.

**Reading.** The staff browser (`readPublished` in `staff/source.js`) sorts
what it finds, in this order:

1. Not an object, or a `format` that is neither of the two above: "This is not
   a staff schedule. Ask the office for the file again."
2. A `version` above 1: "This schedule was made for a newer staff browser than
   the one in this file. Ask the office for a new copy."
3. A `version` that is not 1, a locked form whose `kdf`, `cipher` or `data` is
   not as above, or data missing a part the pages need: "This file is damaged:
   part of it is missing or was changed. Ask the office for a new copy."
4. A locked form asks for the passcode, unless the device holds a key that
   opens it. A key that does not open it is deleted and the passcode asked
   again. A wrong passcode: "That passcode did not open this schedule. Check
   it and try again."

**On the reader's device**, in localStorage, per school, and never changed:
`sv2staff:<schoolId>:me`, `:notes`, `:day`, `:key` (the key, base64) and
`:seen` (the newest `publishedAt` opened there). Where the browser keeps
nothing, the values last as long as the page is open and the staff browser
says once: "This browser does not keep settings for files opened this way."

**The recorded baseline.** `test/publish/baseline/` holds the sample school
published at a fixed clock: `published.json`, `locked.json` and the hashes of
the file's code in `code.txt`. `node test/publish/baseline.mjs` fails when
what staff receive differs from it; `--update` records it again, on purpose.
