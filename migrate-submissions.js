/**
 * migrate-submissions.js
 *
 * One-off migration script.
 * Copies all documents from the top-level `submissions` collection into
 * the appropriate user subcollection:
 *
 *   users/{userId}/privateSubmissions/{docId}   (matchType === 'private')
 *   users/{userId}/publicSubmissions/{docId}    (matchType === 'public' or unknown)
 *
 * Safe to run multiple times — uses the original doc ID so re-runs are idempotent.
 *
 * Usage:
 *   node migrate-submissions.js
 */

require('dotenv').config();
const admin = require('firebase-admin');

// ── Firebase Admin init ────────────────────────────────────────────────────────
const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function migrate() {
  console.log('📦 Reading top-level submissions collection…');
  const snap = await db.collection('submissions').get();

  if (snap.empty) {
    console.log('✅ No documents found in submissions — nothing to migrate.');
    return;
  }

  console.log(`📄 Found ${snap.size} submission document(s). Migrating…\n`);

  let success = 0;
  let skipped = 0;
  let errors  = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const { userId, matchType } = data;

    if (!userId) {
      console.warn(`⚠️  Skipping doc ${docSnap.id} — missing userId`);
      skipped++;
      continue;
    }

    const subColl  = matchType === 'private' ? 'privateSubmissions' : 'publicSubmissions';
    const destRef  = db.collection('users').doc(userId).collection(subColl).doc(docSnap.id);

    try {
      await destRef.set({
        ...data,
        // Ensure matchType is always present in migrated doc
        matchType: matchType || 'public',
        // Preserve original Firestore Timestamps (no conversion needed)
      }, { merge: false });

      console.log(`✅ Migrated ${docSnap.id} → users/${userId}/${subColl}/${docSnap.id}`);
      success++;
    } catch (err) {
      console.error(`❌ Failed to migrate ${docSnap.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n── Migration complete ──`);
  console.log(`   ✅ Migrated: ${success}`);
  console.log(`   ⚠️  Skipped:  ${skipped}`);
  console.log(`   ❌ Errors:   ${errors}`);
  console.log(`\nThe original top-level submissions collection has NOT been deleted.`);
  console.log(`Once you verify the data, you can delete it manually in the Firebase console.`);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
