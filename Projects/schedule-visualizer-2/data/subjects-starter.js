// The starter subject list a new project begins with: code, name, colour.
// A school edits it freely. The list itself is kept in engine/schema.js,
// because the engine imports nothing outside engine/ and newProject() needs it;
// this module is where the page and the tests ask for it.

import { STARTER_SUBJECTS } from '../engine/schema.js';

export const subjectsStarter = STARTER_SUBJECTS;
