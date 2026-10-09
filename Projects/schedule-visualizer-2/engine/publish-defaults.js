// The staff passcode a new project starts with (spec 12.5): publishing is
// protected by default, and the default is built into the tool. It is public,
// as anything in public code is; the publish dialog says what that means.
//
// It has a module to itself for one reason: a published file carries the
// source of every module on the staff manifest (staff/manifest.js), and a
// file locked with a passcode must not spell that passcode in its own code.
// So this module is never on the manifest, and no module on it imports this
// one. schema.js is on it, which is why newProject() and defaultPublish() take
// the passcode from their caller instead of knowing one. The publish-data
// test reads an assembled file and fails if the word is in it.

export const DEFAULT_PASSCODE = 'bulldogs2015';
