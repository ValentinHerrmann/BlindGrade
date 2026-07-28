/**
 * Dexie version upgrade hooks for future schema changes.
 *
 * When the schema changes in a future release, add a new version block here.
 * Do NOT modify existing version(1) — Dexie uses version numbers to detect upgrades.
 *
 * Example for version 2:
 *
 *   db.version(2).stores({
 *     exams: 'id, teacherId, retentionUntil, newField',
 *   }).upgrade((tx) => {
 *     return tx.table('exams').toCollection().modify((exam) => {
 *       exam.newField = 'defaultValue';
 *     });
 *   });
 */

// No migrations beyond version 1 yet.
// Import db to ensure migration hooks are registered.
import { db } from './db';
export { db };
