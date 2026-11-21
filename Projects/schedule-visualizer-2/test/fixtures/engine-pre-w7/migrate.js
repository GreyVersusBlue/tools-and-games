// The version chain. migrate(project) brings an older project up to
// CURRENT_VERSION one step at a time and never changes what it is given.
// A project with no version is version 0. A newer one is refused whole, with
// the message below: no partial import, ever. repair() runs after this on
// every load and fills what a step leaves out.

import { FORMAT, CURRENT_VERSION } from './schema.js';

export const NEWER_VERSION_MESSAGE = 'This file was made by a newer Schedule Visualizer 2. Open it at greyversusblue.com, or ask for a file saved in format 1.';
export const NOT_A_PROJECT_MESSAGE = 'This is not a Schedule Visualizer 2 project. Choose a project file the tool exported.';

export class MigrateError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MigrateError';
    this.code = code;
  }
}

// Version 0 is data from before files carried a version. Two things changed
// shape on the way to 1: a scenario held one day type for all of its changes,
// and each change now names its own.
function fromVersion0(project) {
  const next = { ...project, format: FORMAT, version: 1 };
  const scenario = project.scenario;
  if (scenario && typeof scenario === 'object' && !Array.isArray(scenario) && 'dayTypeId' in scenario) {
    const { dayTypeId, ...rest } = scenario;
    next.scenario = {
      ...rest,
      changes: Array.isArray(scenario.changes)
        ? scenario.changes.map((change) => (change && typeof change === 'object' && change.dayTypeId === undefined ? { ...change, dayTypeId } : change))
        : scenario.changes,
    };
  }
  return next;
}

export const MIGRATION_STEPS = [fromVersion0];

export function versionOf(project) {
  const version = project ? project.version : undefined;
  if (version === undefined || version === null) return 0;
  return version;
}

export function migrate(project) {
  if (project === null || typeof project !== 'object' || Array.isArray(project)) {
    throw new MigrateError(NOT_A_PROJECT_MESSAGE, 'not-a-project');
  }
  let version = versionOf(project);
  if (!Number.isInteger(version) || version < 0) {
    throw new MigrateError(NOT_A_PROJECT_MESSAGE, 'not-a-project');
  }
  if (version > CURRENT_VERSION) {
    throw new MigrateError(NEWER_VERSION_MESSAGE, 'newer-version');
  }
  let current = project;
  while (version < CURRENT_VERSION) {
    current = MIGRATION_STEPS[version](current);
    version = current.version;
  }
  return current;
}
