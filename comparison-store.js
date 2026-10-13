const fs = require('fs');
const path = require('path');
const { normalizeComparisonSnapshot } = require('./comparison');

const MAX_SNAPSHOTS = 24;

class ComparisonStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  get(key) {
    const targetKey = String(key || '').trim().slice(0, 4_000);
    if (!targetKey) return null;
    return this.read().find((snapshot) => snapshot.key === targetKey) || null;
  }

  all() {
    return this.read();
  }

  save(value) {
    const snapshot = normalizeComparisonSnapshot(value);
    if (!snapshot) throw new Error('Не вдалося зберегти знімок порівняння.');
    const snapshots = [
      snapshot,
      ...this.read().filter((item) => item.key !== snapshot.key),
    ].slice(0, MAX_SNAPSHOTS);
    this.write(snapshots);
    return snapshot;
  }

  merge(values) {
    const current = this.read();
    const imported = (Array.isArray(values) ? values : []).map(normalizeComparisonSnapshot).filter(Boolean);
    let added = 0;
    let updated = 0;
    for (const snapshot of imported) {
      const index = current.findIndex((item) => item.key === snapshot.key);
      if (index < 0) {
        current.push(snapshot);
        added += 1;
      } else if (Date.parse(snapshot.capturedAt) > Date.parse(current[index].capturedAt)) {
        current[index] = snapshot;
        updated += 1;
      }
    }
    const snapshots = current
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))
      .slice(0, MAX_SNAPSHOTS);
    if (added || updated) this.write(snapshots);
    return { added, updated, total: snapshots.length };
  }

  read() {
    for (const filePath of [this.filePath, `${this.filePath}.bak`]) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!Array.isArray(parsed?.snapshots)) continue;
        return parsed.snapshots.map(normalizeComparisonSnapshot).filter(Boolean).slice(0, MAX_SNAPSHOTS);
      } catch (_error) {
        // Спробувати резервну копію або почати з порожнього сховища.
      }
    }
    return [];
  }

  write(snapshots) {
    const temporaryFile = `${this.filePath}.tmp`;
    const backupFile = `${this.filePath}.bak`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(temporaryFile, JSON.stringify({ version: 1, snapshots }), 'utf8');
    if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, backupFile);
    fs.copyFileSync(temporaryFile, this.filePath);
    try { fs.unlinkSync(temporaryFile); } catch (_error) {}
  }
}

module.exports = { ComparisonStore, MAX_SNAPSHOTS };
