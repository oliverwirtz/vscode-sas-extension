// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const temporaryLibrariesByLibref = new Map<string, string>();
const temporaryLibrariesByPath = new Map<string, string>();

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").trim().toLowerCase();
}

export function trackTemporaryLibrary(libref: string, path: string): void {
  const normalizedLibref = libref.trim().toUpperCase();
  const normalizedPath = normalizePath(path);

  if (!normalizedLibref || !normalizedPath) {
    return;
  }

  temporaryLibrariesByLibref.set(normalizedLibref, normalizedPath);
  temporaryLibrariesByPath.set(normalizedPath, normalizedLibref);
}

export function untrackTemporaryLibrary(libref: string): void {
  const normalizedLibref = libref.trim().toUpperCase();
  const trackedPath = temporaryLibrariesByLibref.get(normalizedLibref);

  if (trackedPath) {
    temporaryLibrariesByPath.delete(trackedPath);
  }

  temporaryLibrariesByLibref.delete(normalizedLibref);
}

export function clearTrackedTemporaryLibraries(): void {
  temporaryLibrariesByLibref.clear();
  temporaryLibrariesByPath.clear();
}

export function getTrackedTemporaryLibraries(): string[] {
  return [...temporaryLibrariesByLibref.keys()];
}

export function getTemporaryLibraryAtPath(path: string): string | undefined {
  return temporaryLibrariesByPath.get(normalizePath(path));
}
