Frozen copies of the engine modules as they were at commit e1455dc8, before
wish group 7 (W7) added its fields. They are the modules that repair.js and
validate.js of that commit import, followed to the end: 28 files, unchanged.

test/engine/w7-files.test.mjs and w7-fields.test.mjs import repair.js and
validate.js from here to show what a planner cached from before W7 does with a
project that carries W7's fields (it must keep them byte for byte and refuse
nothing), and what its nextConnectionLabel does.

Do not edit these files and do not update them to the current engine: the test
is only worth anything while this is the old code. They are here, not read from
git, because CI checks out shallow.
