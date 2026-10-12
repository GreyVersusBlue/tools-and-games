# The Fracture Cycle: the fourth prong

Design notes for the prong Devon approved on 2026-10-01 (BACKLOG Q49, rank 22).
Decision #958 in `HISTORY.md`. Written before the prose, kept beside the game
because the game has no other notes file.

## The three it joins, measured

Read off `Projects/the-fracture-cycle.html` at d40aa09 with
`node test/smoke.mjs --paths`: 25 nodes, 36 choices, 5 endings, 171 complete
paths from `intro` to an ending, 2,591 words of titles, prose and choice
labels.

A prong is four nodes. A gate with two choices, a meeting with one, a test
with two, and a result with one that hands over a fragment and sends the
player to Roseleaf. So each prong is four ways through and about 330 words.
The choices move `align` and `favor`, and only two things in the game read
them: the status bar, and the list of choices at the socket.

All three prongs join the trunk at `hub_bazaar`. From there the player goes
straight to the socket, or through `side_hub`, where a contact for each power
not yet met hands over that power's fragment. Each contact's piece comes tied
to a hand: the Sanctuary's for a promise to be watched, the Wildwoods' for a
debt, the tower's because its master said the player would come. At the socket
the choices offered depend on `align`, `favor.invoker` and how many fragments
are carried. Five endings. The save holds which endings have been seen and
nothing else.

## What the fourth is about

The three prongs all answer one question: whose are you. Each court, and the
tower, tells the player what it is and hands it a piece inside four screens.

Two things the game says and never comes back to. The intro: "Before you have
a name, you have a place", under a subtitle that reads "A soul with no name
yet", and "Whatever pulled you into being wants a witness, or a weapon, or
both." And the worst ending: the Cycle "starts over, somewhere worse, with
someone else waking up at the seam wondering why."

So the player is not the first, nothing says what woke them, and they never
get a name. The three prongs make a weapon. The fourth is the witness: who
woke before you, what wakes you, and what you answer to. It is not a fourth
power and it has no fragment. The Shard split three ways and the socket holds
three; a fourth piece would be a copy of the other prongs with the colour
changed.

## Where it leaves and where it rejoins

It leaves at `intro`, as a fourth choice that is not a road: the player takes
none of the three and walks along the seam itself. It rejoins at `hub_bazaar`
like the others, carrying no fragment, and comes back out of the trunk at
`core_confrontation`, where a walker gets one more choice (every walker has a
name by then: the stone offers two and no way round). That choice leads to the
payoff node and the prong's two endings.

## Beginning

`seam_walk`, "The Unlit Way". The seam runs on past the place the player woke,
unlit. The ground has footprints on it, all the size of the player's own, all
leading away down one of the three roads, none coming back. Three choices, the
only place the prong moves the status bar: lean toward the gold (`align` +1),
toward the crimson (`align` -1), or keep to the line (nothing moves, and the
bar goes on reading Unaligned).

## Middle

`seam_cairn`, "The Count". Where the prints leave the line there is a cairn,
one stone for each one who woke, and Orrin, who keeps it. Orrin says what the
Cycle is from the outside: something hums, one of you wakes, a court tells it
what it is, it chooses at the hollow, and the humming starts again.

`seam_stone`, "The Top Stone". The marks are not names; none of them had one.
The top stone is blank and is the player's. Two choices: take the name the
first of them muttered and Orrin has kept (`seam.name` = `borne`), or cut a
mark of their own and answer to that (`seam.name` = `own`). The name is never
printed. The game does not name the player and this does not either.

`seam_named`, "A Name on the Seam". Orrin sends the player to Roseleaf and says
what the old side nodes already show: each piece comes tied to a hand.

## Payoff

At the socket a named walker may say the name into the hollow instead of
setting anything down. `seam_answer`, "What the Hollow Wanted": the socket is
what woke them, and every one before. It was never short of pieces. It wanted
someone who would stay and see what was chosen, and every one it woke was told
what it was on the way and was gone as soon as it chose.

Two endings.

- `end_witness`, "The Count Kept". The player leaves the socket empty, goes
  back up and takes the place by the cairn. The Cycle goes on, and the next
  one to wake does not wake alone. Open to every named walker.
- `end_named`, "The Last Waking". The player gives the hollow the name and
  stays. The Shard is still three pieces in three sets of hands; nothing about
  the courts is settled. Nothing else is woken. Open only to a walker whose
  name is their own and whose hands are empty.

## State

One object, written at the entrance and nowhere else: `state.seam = { name }`.
`initialState()` does not change, so a run on an old prong carries exactly the
state it always did, and the suite checks that no old path ends with a `seam`
key. The socket's extra choice asks only whether `state.seam` is there; `seam.name`
is read by the payoff's list. `mainPath` is set to `'seam'` as the other three set theirs.

The save gains two ending ids at the end of `ENDING_IDS`. Same key, same
version: a save from before loads with what it had and reads 5 of 7.

## What crosses

Old into new. A walker reaches Roseleaf with no fragment and has met nobody,
so `side_hub` offers all three contacts. What they take there decides the
payoff: with one piece or more the name cannot be given, because every piece
came with a promise, a debt or a prediction attached, and the way back to the
cairn is worded for full hands. Walking the seam never moves `align` past 1
either way, so a walker is never offered the Sanctuary's ending or the
Wildwoods'. Whoever walked the line cannot hand the Shard to a court. The
other three old endings stay open to them.

New into old. Nothing. A run that starts down a road never sees a seam node,
a seam choice or a seam ending, and plays word for word as it did. That is
the condition the prong was approved under, and the suite pins it: all 171 old
paths, every step, by hash.

## For a player who has finished the other three

The tracker shows two unknown endings. The intro has a fourth choice. Taking it
is the only run in which nobody tells them what they are, and the only one
that says what the socket has been doing all along. The worst ending's last
line gets an answer in "The Last Waking".

## As built

7 nodes (5 screens and 2 endings), 10 choices of its own and 2 more on old
nodes (the entrance, the hollow), 1,184 words. The game is 32 nodes, 48
choices, 7 endings, 3,775 words and 519 paths: the 171 old ones and 348 that
start on the seam, ending 102 on "The Fourth Way", 36 on "The Threefold
Aegis", 102 on "What the Socket Wasn't Ready For", 102 on "The Count Kept" and
6 on "The Last Waking". The six are three leans by one name by one way through
Roseleaf, the one that picks nothing up.

## No engine change

Same node shape, same `effect` functions, same function-built choice lists as
`side_hub` and `core_confrontation`, the same one substitution (`${fragCount}`)
in the payoff node. No new element, class or style, so the new screens are the
old screens with different words: one `h2`, paragraphs, buttons.
